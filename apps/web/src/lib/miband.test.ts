import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MiBand5Client } from "./miband";
import { UUIDS } from "./protocol";

const KEY = "00112233445566778899aabbccddeeff";

class Characteristic extends EventTarget {
  value = new DataView(new Uint8Array([0, 80, 0]).buffer);
  startNotifications = vi.fn(async () => this);
  readValue = vi.fn(async () => this.value);
  writeValue = vi.fn(async (_value: Uint8Array) => {});
  notify(bytes: number[]) {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

function fixture() {
  const auth = new Characteristic();
  const heart = new Characteristic();
  const control = new Characteristic();
  const steps = new Characteristic();
  const battery = new Characteristic();
  const characteristics = new Map<string, Characteristic>([
    [UUIDS.authCharacteristic, auth], [UUIDS.heartRateMeasurement, heart],
    [UUIDS.heartRateControl, control], [UUIDS.steps, steps], [UUIDS.battery, battery],
  ]);
  const device = Object.assign(new EventTarget(), {
    name: "Mi Smart Band 5",
    gatt: {
      connected: false,
      connect: vi.fn(async () => { device.gatt.connected = true; return device.gatt; }),
      disconnect: vi.fn(() => {
        device.gatt.connected = false;
        device.dispatchEvent(new Event("gattserverdisconnected"));
      }),
      getPrimaryService: vi.fn(async () => ({
        getCharacteristic: vi.fn(async (uuid: string) => characteristics.get(uuid)),
      })),
    },
  });
  auth.writeValue.mockImplementation(async () => auth.notify([0x10, 0x03, 0x01]));
  const requestDevice = vi.fn(async () => device);
  vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
  const onPhase = vi.fn();
  const onSnapshot = vi.fn();
  const client = new MiBand5Client({ onPhase, onSnapshot });
  return { client, auth, heart, control, steps, battery, device, requestDevice, onPhase, onSnapshot };
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("isSecureContext", true);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Mi Band connection lifetime", () => {
  it("uses writes without response when the authentication characteristic requires them", async () => {
    const f = fixture();
    const writeWithoutResponse = vi.fn(async () => f.auth.notify([0x10, 0x03, 0x01]));
    Object.assign(f.auth, { properties: { write: false, writeWithoutResponse: true }, writeValueWithoutResponse: writeWithoutResponse });
    f.auth.writeValue.mockRejectedValue(new Error('ATT 6: write request unsupported'));
    await f.client.connect(KEY);
    expect(writeWithoutResponse).toHaveBeenCalledWith(Uint8Array.from([0x02, 0x00]));
    expect(f.auth.writeValue).not.toHaveBeenCalled();
    await f.client.disconnect();
  });
  it("writes the encrypted challenge response before starting measurements", async () => {
    const f = fixture();
    f.auth.writeValue.mockImplementation(async (payload) => {
      if (payload[0] === 0x02) {
        f.auth.notify([0x10, 0x02, 0x01, 0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
      } else {
        expect(Array.from(payload)).toEqual([
          3, 0, 0x69, 0xc4, 0xe0, 0xd8, 0x6a, 0x7b, 4, 0x30, 0xd8, 0xcd, 0xb7, 0x80, 0x70, 0xb4, 0xc5, 0x5a,
        ]);
        expect(f.control.writeValue).not.toHaveBeenCalled();
        f.auth.notify([0x10, 0x03, 0x01]);
      }
    });
    await f.client.connect("000102030405060708090a0b0c0d0e0f");
    expect(f.auth.writeValue).toHaveBeenCalledTimes(2);
    expect(f.control.writeValue).toHaveBeenCalledTimes(3);
    await f.client.disconnect();
  });

  it("disconnects a rejected authentication and permits a clean retry", async () => {
    const f = fixture();
    f.auth.writeValue.mockImplementationOnce(async () => f.auth.notify([0x10, 0x03, 0x04]));
    await expect(f.client.connect(KEY)).rejects.toThrow(/rejected/);
    expect(f.device.gatt.connected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await f.client.connect(KEY);
    expect(f.onPhase).toHaveBeenLastCalledWith("connected", expect.any(String));
    await f.client.disconnect();
  });

  it("releases a connection when service discovery fails", async () => {
    const f = fixture();
    f.device.gatt.getPrimaryService.mockRejectedValueOnce(new Error("service missing"));
    await expect(f.client.connect(KEY)).rejects.toThrow("service missing");
    expect(f.device.gatt.connected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects simultaneous connect attempts without a second chooser", async () => {
    const f = fixture();
    await f.client.connect(KEY);
    await expect(f.client.connect(KEY)).rejects.toThrow(/already/);
    expect(f.requestDevice).toHaveBeenCalledTimes(1);
    await f.client.disconnect();
  });

  it("cancels a pending chooser without connecting its eventual result", async () => {
    const f = fixture();
    let selected!: (device: typeof f.device) => void;
    f.requestDevice.mockImplementationOnce(() => new Promise((resolve) => { selected = resolve; }));
    const pending = f.client.connect(KEY);
    await f.client.disconnect();
    selected(f.device);
    await expect(pending).rejects.toThrow(/cancel/i);
    expect(f.device.gatt.connect).not.toHaveBeenCalled();
    expect(f.onPhase).not.toHaveBeenCalledWith("connected", expect.any(String));
  });

  it("settles authentication immediately when the link is lost", async () => {
    const f = fixture();
    f.auth.writeValue.mockImplementation(async () => {});
    const pending = f.client.connect(KEY);
    const rejected = expect(pending).rejects.toThrow(/disconnect|lost|cancel/i);
    await vi.waitFor(() => expect(f.auth.writeValue).toHaveBeenCalled());
    f.device.gatt.disconnect();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up an authentication timeout", async () => {
    const f = fixture();
    f.auth.writeValue.mockImplementation(async () => {});
    const pending = f.client.connect(KEY);
    const rejected = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(15_100);
    await rejected;
    expect(f.device.gatt.connected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes old measurement listeners when disconnected", async () => {
    const f = fixture();
    await f.client.connect(KEY);
    f.heart.notify([0, 72]);
    expect(f.onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ heartRate: 72 }));
    await f.client.disconnect();
    f.onSnapshot.mockClear();
    f.heart.notify([0, 90]);
    expect(f.onSnapshot).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("serializes periodic GATT operations even when intervals coincide", async () => {
    const f = fixture();
    await f.client.connect(KEY);
    let active = 0;
    let maximum = 0;
    const operation = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    };
    f.control.writeValue.mockImplementation(async () => operation());
    f.steps.readValue.mockImplementation(async () => { await operation(); return f.steps.value; });
    f.battery.readValue.mockImplementation(async () => { await operation(); return f.battery.value; });
    await vi.advanceTimersByTimeAsync(60_100);
    expect(maximum).toBe(1);
    await f.client.disconnect();
  });

  it("waits for a slow heartbeat write before reading the summary", async () => {
    const f = fixture();
    await f.client.connect(KEY);
    f.steps.readValue.mockClear();
    f.control.writeValue.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    });
    await vi.advanceTimersByTimeAsync(15_100);
    expect(f.steps.readValue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.steps.readValue).toHaveBeenCalledOnce();
    await f.client.disconnect();
  });

  it("does not resend an old heart rate when only battery or steps changed", async () => {
    const f = fixture();
    await f.client.connect(KEY);
    f.heart.notify([0, 72]);
    f.onSnapshot.mockClear();
    await vi.advanceTimersByTimeAsync(15_100);
    expect(f.onSnapshot).toHaveBeenCalledTimes(2);
    for (const [reading] of f.onSnapshot.mock.calls) expect(reading).not.toHaveProperty("heartRate");
    await f.client.disconnect();
  });

  it("disconnects a GATT connection that completes after cancellation", async () => {
    const f = fixture();
    let connected!: () => void;
    f.device.gatt.connect.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { connected = resolve; });
      f.device.gatt.connected = true;
      return f.device.gatt;
    });
    const pending = f.client.connect(KEY);
    const rejected = expect(pending).rejects.toThrow(/cancel/i);
    await vi.waitFor(() => expect(f.device.gatt.connect).toHaveBeenCalled());
    await f.client.disconnect();
    connected();
    await rejected;
    expect(f.device.gatt.connected).toBe(false);
  });
});
