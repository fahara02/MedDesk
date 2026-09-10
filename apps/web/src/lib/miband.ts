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

interface Callbacks {
  onPhase: (phase: ConnectionPhase, message?: string) => void;
  onSnapshot: (snapshot: BandSnapshot) => void;
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
  private snapshot: BandSnapshot = {};

  constructor(private readonly callbacks: Callbacks) {}

  static isSupported() {
    return "bluetooth" in navigator;
  }

  async connect(rawAuthKey: string) {
    const authKey = normalizeAuthKey(rawAuthKey);
    if (!MiBand5Client.isSupported()) {
      throw new Error("Web Bluetooth is unavailable. Open this page in current Chrome or Edge on Windows.");
    }

    this.callbacks.onPhase("selecting", "Choose your Mi Band 5 in the browser window.");
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [UUIDS.advertisement] }],
      optionalServices: [UUIDS.primary, UUIDS.authentication, UUIDS.heartRate],
    });
    this.device.addEventListener("gattserverdisconnected", this.handleDisconnect);

    this.callbacks.onPhase("connecting", "Opening the Bluetooth connection…");
    if (!this.device.gatt) throw new Error("The selected device does not expose a GATT server.");
    this.server = await this.device.gatt.connect();
    await this.loadCharacteristics();

    this.callbacks.onPhase("authenticating", "Unlocking the band with your local auth key…");
    await this.authenticate(authKey);
    await this.startMonitoring();

    this.callbacks.onPhase("connected", `Live from ${this.device.name || "Mi Band 5"}`);
  }

  async disconnect() {
    this.stopTimers();
    try {
      await this.heartRateControl?.writeValue(Uint8Array.from([0x15, 0x01, 0x00]));
    } catch {
      // The GATT link may already be gone.
    }
    this.device?.gatt?.disconnect();
    this.callbacks.onPhase("disconnected", "Band disconnected.");
  }

  private async loadCharacteristics() {
    if (!this.server) throw new Error("Bluetooth is not connected.");
    const primary = await this.server.getPrimaryService(UUIDS.primary);
    const authentication = await this.server.getPrimaryService(UUIDS.authentication);
    const heartRate = await this.server.getPrimaryService(UUIDS.heartRate);

    this.auth = await authentication.getCharacteristic(UUIDS.authCharacteristic);
    this.heartRateControl = await heartRate.getCharacteristic(UUIDS.heartRateControl);
    this.heartRateMeasurement = await heartRate.getCharacteristic(UUIDS.heartRateMeasurement);
    this.steps = await primary.getCharacteristic(UUIDS.steps);
    this.battery = await primary.getCharacteristic(UUIDS.battery);
  }

  private async authenticate(authKey: string) {
    if (!this.auth) throw new Error("The Mi Band authentication characteristic is missing.");

    await this.auth.startNotifications();
    await new Promise<void>(async (resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => finish(new Error("Authentication timed out. Check the auth key.")), 15_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.auth?.removeEventListener("characteristicvaluechanged", handleAuth);
        error ? reject(error) : resolve();
      };
      const handleAuth = async (event: Event) => {
        try {
          const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
          if (!value || value.byteLength < 3) return;
          const command = [value.getUint8(0), value.getUint8(1), value.getUint8(2)];

          if (command[0] === 0x10 && command[1] === 0x02 && command[2] === 0x01) {
            const challenge = new Uint8Array(value.buffer, value.byteOffset + 3, value.byteLength - 3);
            const response = await encryptChallenge(challenge.slice(0, 16), authKey);
            const payload = new Uint8Array(18);
            payload.set([0x03, 0x00]);
            payload.set(response, 2);
            await this.auth?.writeValue(payload);
          } else if (command[0] === 0x10 && command[1] === 0x03 && command[2] === 0x01) {
            finish();
          } else if (command[0] === 0x10 && command[1] === 0x03) {
            finish(new Error("The band rejected the auth key. Extract the current key again."));
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error("Authentication failed."));
        }
      };

      this.auth?.addEventListener("characteristicvaluechanged", handleAuth);
      try {
        await this.auth?.writeValue(Uint8Array.from([0x02, 0x00]));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Could not start authentication."));
      }
    });
  }

  private async startMonitoring() {
    if (!this.heartRateControl || !this.heartRateMeasurement) {
      throw new Error("The Mi Band heart-rate service is missing.");
    }

    await this.heartRateControl.writeValue(Uint8Array.from([0x15, 0x02, 0x00]));
    await this.heartRateControl.writeValue(Uint8Array.from([0x15, 0x01, 0x00]));
    await this.heartRateMeasurement.startNotifications();
    this.heartRateMeasurement.addEventListener("characteristicvaluechanged", this.handleHeartRate);
    await this.heartRateControl.writeValue(Uint8Array.from([0x15, 0x01, 0x01]));

    await this.refreshSummary();
    this.keepAliveTimer = window.setInterval(() => {
      void this.heartRateControl?.writeValue(Uint8Array.from([0x16])).catch(() => undefined);
    }, HEART_RATE_KEEPALIVE_MS);
    this.summaryTimer = window.setInterval(() => void this.refreshSummary(), SUMMARY_REFRESH_MS);
  }

  private readonly handleHeartRate = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const heartRate = parseHeartRate(value);
    this.emit({ heartRate });
  };

  private async refreshSummary() {
    try {
      if (this.steps) this.emit(parseSteps(await this.steps.readValue()));
      if (this.battery) this.emit(parseBattery(await this.battery.readValue()));
    } catch (error) {
      console.warn("Could not refresh the band summary", error);
    }
  }

  private emit(update: BandSnapshot) {
    this.snapshot = {
      ...this.snapshot,
      ...update,
      deviceName: this.device?.name || "Mi Band 5",
      observedAt: new Date().toISOString(),
    };
    this.callbacks.onSnapshot(this.snapshot);
  }

  private readonly handleDisconnect = () => {
    this.stopTimers();
    this.callbacks.onPhase("disconnected", "Bluetooth link lost. Reconnect when the band is nearby.");
  };

  private stopTimers() {
    if (this.keepAliveTimer) window.clearInterval(this.keepAliveTimer);
    if (this.summaryTimer) window.clearInterval(this.summaryTimer);
    this.keepAliveTimer = undefined;
    this.summaryTimer = undefined;
  }
}
