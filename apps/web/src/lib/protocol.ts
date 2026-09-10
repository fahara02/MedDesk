export const UUIDS = {
  advertisement: 0xfee0,
  primary: "0000fee0-0000-1000-8000-00805f9b34fb",
  authentication: "0000fee1-0000-1000-8000-00805f9b34fb",
  heartRate: "0000180d-0000-1000-8000-00805f9b34fb",
  authCharacteristic: "00000009-0000-3512-2118-0009af100700",
  heartRateMeasurement: "00002a37-0000-1000-8000-00805f9b34fb",
  heartRateControl: "00002a39-0000-1000-8000-00805f9b34fb",
  battery: "00000006-0000-3512-2118-0009af100700",
  steps: "00000007-0000-3512-2118-0009af100700",
} as const;

export function normalizeAuthKey(value: string) {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{32}$/i.test(normalized)) {
    throw new Error("The auth key must contain exactly 32 hexadecimal characters.");
  }
  return normalized.toLowerCase();
}

export function hexToBytes(value: string) {
  const normalized = normalizeAuthKey(value);
  return Uint8Array.from(normalized.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export async function encryptChallenge(challenge: Uint8Array, authKey: string) {
  if (challenge.byteLength !== 16) throw new Error("The band returned an invalid authentication challenge.");
  const rawKey = Uint8Array.from(hexToBytes(authKey));
  const challengeBlock = Uint8Array.from(challenge);
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey.buffer,
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: new Uint8Array(16) },
    key,
    challengeBlock.buffer,
  );
  return new Uint8Array(encrypted).slice(0, 16);
}

export function parseHeartRate(value: DataView) {
  if (value.byteLength < 2) throw new Error("Heart-rate packet is too short.");
  const uses16BitValue = (value.getUint8(0) & 0x01) === 0x01;
  if (uses16BitValue && value.byteLength < 3) throw new Error("Heart-rate packet is too short.");
  return uses16BitValue ? value.getUint16(1, true) : value.getUint8(1);
}

export function parseSteps(value: DataView) {
  if (value.byteLength < 3) throw new Error("Step packet is too short.");
  return {
    steps: value.getUint16(1, true),
    distanceMeters: value.byteLength >= 9 ? value.getUint32(5, true) : undefined,
    calories: value.byteLength >= 13 ? value.getUint32(9, true) : undefined,
  };
}

export function parseBattery(value: DataView) {
  if (value.byteLength < 2) throw new Error("Battery packet is too short.");
  return { batteryPercent: value.getUint8(1), charging: value.byteLength > 2 && value.getUint8(2) !== 0 };
}
