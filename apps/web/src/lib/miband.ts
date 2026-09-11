import type { BandSnapshot, ConnectionPhase } from "../types";
import {
  encryptChallenge,
  normalizeAuthKey,
  parseBattery,
  parseHeartRate,
  parseSteps,
  UUIDS,
} from "./protocol";

const HEART_RATE_KEEPALIVE_MS = 12_000;
const SUMMARY_REFRESH_MS = 15_000;

function writeBandValue(characteristic: BluetoothRemoteGATTCharacteristic, value: BufferSource) {
  if (characteristic.properties?.writeWithoutResponse && typeof characteristic.writeValueWithoutResponse === 'function') return characteristic.writeValueWithoutResponse(value);
  if (characteristic.properties?.write && typeof characteristic.writeValueWithResponse === 'function') return characteristic.writeValueWithResponse(value);
  return characteristic.writeValue(value);
}

interface Callbacks {
  onPhase: (phase: ConnectionPhase, message?: string) => void;
  onSnapshot: (snapshot: BandSnapshot) => void;
}

interface Session {
  abort: AbortController;
  queue: Promise<void>;
}

export class MiBand5Client {
  private device?: BluetoothDevice;
  private server?: BluetoothRemoteGATTServer;
  private auth?: BluetoothRemoteGATTCharacteristic;
  private heartRateControl?: BluetoothRemoteGATTCharacteristic;
  private heartRateMeasurement?: BluetoothRemoteGATTCharacteristic;
  private steps?: BluetoothRemoteGATTCharacteristic;
  private battery?: BluetoothRemoteGATTCharacteristic;
  private keepAliveTimer?: number;
  private summaryTimer?: number;
  private session?: Session;

  constructor(private readonly callbacks: Callbacks) {}

  static isSupported() {
    return "bluetooth" in navigator;
  }

  async connect(rawAuthKey: string) {
    if (this.session) throw new Error("A band connection is already active. Disconnect it first.");
    const authKey = normalizeAuthKey(rawAuthKey);
    if (!MiBand5Client.isSupported()) {
      throw new Error("Web Bluetooth is unavailable. Open this page in current Chrome or Edge on Windows.");
    }

    const session: Session = { abort: new AbortController(), queue: Promise.resolve() };
    this.session = session;
    try {
      this.callbacks.onPhase("selecting", "Choose your Mi Band 5 in the browser window.");
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [UUIDS.advertisement] },
          { name: "Mi Smart Band 5" },
          { name: "Mi Band 5" },
        ],
        optionalServices: [UUIDS.primary, UUIDS.authentication, UUIDS.heartRate],
      });
      this.assertActive(session);
      this.device = device;
      device.addEventListener("gattserverdisconnected", this.handleDisconnect);

      this.callbacks.onPhase("connecting", "Opening the Bluetooth connection…");
      if (!device.gatt) throw new Error("The selected device does not expose a GATT server.");
      this.server = await this.run(session, async () => {
        const server = await device.gatt!.connect();
        if (session.abort.signal.aborted) server.disconnect();
        return server;
      });
      await this.loadCharacteristics(session);
      this.callbacks.onPhase("authenticating", "Unlocking the band with your local auth key…");
      await this.authenticate(authKey, session);
      await this.startMonitoring(session);
      this.assertActive(session);
      this.callbacks.onPhase("connected", `Live from ${device.name || "Mi Band 5"}`);
    } catch (error) {
      this.release(session);
      throw error;
    }
  }

  async disconnect() {
    if (this.session) this.release(this.session);
    this.callbacks.onPhase("disconnected", "Band disconnected.");
  }

  private async loadCharacteristics(session: Session) {
    if (!this.server) throw new Error("Bluetooth is not connected.");
    const server = this.server;
    const primary = await this.run(session, () => server.getPrimaryService(UUIDS.primary));
    const authentication = await this.run(session, () => server.getPrimaryService(UUIDS.authentication));
    const heartRate = await this.run(session, () => server.getPrimaryService(UUIDS.heartRate));

    this.auth = await this.run(session, () => authentication.getCharacteristic(UUIDS.authCharacteristic));
    this.heartRateControl = await this.run(session, () => heartRate.getCharacteristic(UUIDS.heartRateControl));
    this.heartRateMeasurement = await this.run(session, () => heartRate.getCharacteristic(UUIDS.heartRateMeasurement));
    this.steps = await this.run(session, () => primary.getCharacteristic(UUIDS.steps));
    this.battery = await this.run(session, () => primary.getCharacteristic(UUIDS.battery));
  }

  private async authenticate(authKey: string, session: Session) {
    if (!this.auth) throw new Error("The Mi Band authentication characteristic is missing.");
    const auth = this.auth;
    await this.run(session, () => auth.startNotifications());
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish(new Error("Authentication timed out. Check the auth key.")), 15_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        auth.removeEventListener("characteristicvaluechanged", handleAuth);
        session.abort.signal.removeEventListener("abort", cancelled);
        error ? reject(error) : resolve();
      };
      const cancelled = () => finish(new Error("Band connection cancelled or disconnected."));
      const handleAuth = async (event: Event) => {
        try {
          if (settled) return;
          const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
          if (!value || value.byteLength < 3) return;
          const command = [value.getUint8(0), value.getUint8(1), value.getUint8(2)];

          if (command[0] === 0x10 && command[1] === 0x02 && command[2] === 0x01) {
            const challenge = new Uint8Array(value.buffer, value.byteOffset + 3, value.byteLength - 3);
            const response = await encryptChallenge(challenge, authKey);
            if (settled) return;
            const payload = new Uint8Array(18);
            payload.set([0x03, 0x00]);
            payload.set(response, 2);
            await this.run(session, () => writeBandValue(auth, payload));
          } else if (command[0] === 0x10 && command[1] === 0x03 && command[2] === 0x01) {
            finish();
          } else if (command[0] === 0x10 && (command[1] === 0x03 || command[1] === 0x02)) {
            finish(new Error("The band rejected the auth key. Extract the current key again."));
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error("Authentication failed."));
        }
      };

      auth.addEventListener("characteristicvaluechanged", handleAuth);
      session.abort.signal.addEventListener("abort", cancelled, { once: true });
      void this.run(session, () => writeBandValue(auth, Uint8Array.from([0x02, 0x00])))
        .catch((error: unknown) => finish(error instanceof Error ? error : new Error("Could not start authentication.")));
    });
  }

  private async startMonitoring(session: Session) {
    if (!this.heartRateControl || !this.heartRateMeasurement) {
      throw new Error("The Mi Band heart-rate service is missing.");
    }

    const control = this.heartRateControl;
    const measurement = this.heartRateMeasurement;
    await this.run(session, () => writeBandValue(control, Uint8Array.from([0x15, 0x02, 0x00])));
    await this.run(session, () => writeBandValue(control, Uint8Array.from([0x15, 0x01, 0x00])));
    measurement.addEventListener("characteristicvaluechanged", this.handleHeartRate);
    await this.run(session, () => measurement.startNotifications());
    await this.run(session, () => writeBandValue(control, Uint8Array.from([0x15, 0x01, 0x01])));

    await this.refreshSummary(session);
    this.keepAliveTimer = window.setTimeout(() => {
      void this.poll(session, "heartbeat");
    }, HEART_RATE_KEEPALIVE_MS);
    this.summaryTimer = window.setTimeout(() => void this.poll(session, "summary"), SUMMARY_REFRESH_MS);
  }

  private readonly handleHeartRate = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value || !this.session) return;
    try {
      const heartRate = parseHeartRate(value);
      if (heartRate >= 25 && heartRate <= 250) this.emit({ heartRate });
    } catch {
      // A malformed notification supplies no measurement.
    }
  };

  private async refreshSummary(session: Session) {
    const steps = this.steps;
    const battery = this.battery;
    if (steps) this.emit(parseSteps(await this.run(session, () => steps.readValue())));
    if (battery) this.emit(parseBattery(await this.run(session, () => battery.readValue())));
  }

  private emit(update: BandSnapshot) {
    if (!this.session || this.session.abort.signal.aborted) return;
    this.callbacks.onSnapshot({
      ...update,
      deviceName: this.device?.name || "Mi Band 5",
      observedAt: new Date().toISOString(),
    });
  }

  private readonly handleDisconnect = () => {
    if (this.session) this.release(this.session);
    this.callbacks.onPhase("disconnected", "Bluetooth link lost. Reconnect when the band is nearby.");
  };

  private async poll(session: Session, kind: "heartbeat" | "summary") {
    try {
      this.assertActive(session);
      if (kind === "heartbeat") {
        const control = this.heartRateControl!;
        await this.run(session, () => writeBandValue(control, Uint8Array.from([0x16])));
        this.keepAliveTimer = window.setTimeout(() => void this.poll(session, kind), HEART_RATE_KEEPALIVE_MS);
      } else {
        await this.refreshSummary(session);
        this.summaryTimer = window.setTimeout(() => void this.poll(session, kind), SUMMARY_REFRESH_MS);
      }
    } catch (error) {
      if (this.session !== session) return;
      this.release(session);
      this.callbacks.onPhase("error", error instanceof Error ? error.message : "Bluetooth operation failed. Reconnect the band.");
    }
  }

  private assertActive(session: Session) {
    if (this.session !== session || session.abort.signal.aborted) {
      throw new Error("Band connection cancelled or disconnected.");
    }
  }

  private run<T>(session: Session, operation: () => Promise<T>): Promise<T> {
    const result = session.queue.then(async () => {
      this.assertActive(session);
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const signal = session.abort.signal;
        const cancel = () => finish(new Error("Band connection cancelled or disconnected."));
        const timer = window.setTimeout(() => finish(new Error("Bluetooth operation timed out. Reconnect the band.")), 15_000);
        const finish = (error?: unknown, value?: T) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          if (error) {
            session.abort.abort();
            reject(error);
          }
          else {
            try { this.assertActive(session); resolve(value as T); }
            catch (failure) { reject(failure); }
          }
        };
        signal.addEventListener("abort", cancel, { once: true });
        void Promise.resolve().then(() => {
          this.assertActive(session);
          return operation();
        }).then((value) => finish(undefined, value), finish);
      });
    });
    session.queue = result.then(() => {}, () => {});
    return result;
  }

  private release(session: Session) {
    if (this.session !== session) return;
    this.session = undefined;
    this.stopTimers();
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnect);
    this.heartRateMeasurement?.removeEventListener("characteristicvaluechanged", this.handleHeartRate);
    session.abort.abort();
    this.device?.gatt?.disconnect();
    this.device = undefined;
    this.server = undefined;
    this.auth = undefined;
    this.heartRateControl = undefined;
    this.heartRateMeasurement = undefined;
    this.steps = undefined;
    this.battery = undefined;
  }

  private stopTimers() {
    if (this.keepAliveTimer) window.clearInterval(this.keepAliveTimer);
    if (this.summaryTimer) window.clearInterval(this.summaryTimer);
    this.keepAliveTimer = undefined;
    this.summaryTimer = undefined;
  }
}
