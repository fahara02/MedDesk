import { describe, expect, it } from "vitest";
import { encryptChallenge, normalizeAuthKey, parseBattery, parseHeartRate, parseSteps } from "./protocol";

describe("Mi Band protocol helpers", () => {
  it("normalizes an auth key", () => {
    expect(normalizeAuthKey("0x00112233445566778899AABBCCDDEEFF")).toBe(
      "00112233445566778899aabbccddeeff",
    );
    expect(() => normalizeAuthKey("not-a-key")).toThrow(/32 hexadecimal/);
  });

  it("encrypts the auth challenge as an AES ECB-compatible first block", async () => {
    const encrypted = await encryptChallenge(
      Uint8Array.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]),
      "000102030405060708090a0b0c0d0e0f",
    );
    expect(Array.from(encrypted)).toEqual([
      0x69, 0xc4, 0xe0, 0xd8, 0x6a, 0x7b, 0x04, 0x30, 0xd8, 0xcd, 0xb7, 0x80, 0x70, 0xb4, 0xc5, 0x5a,
    ]);
  });

  it("parses standard heart rate and Huami summary packets", () => {
    expect(parseHeartRate(new DataView(Uint8Array.from([0, 72]).buffer))).toBe(72);
    expect(parseSteps(new DataView(Uint8Array.from([0, 0x34, 0x12, 0, 0, 0x10, 0, 0, 0, 0x2a, 0, 0, 0]).buffer))).toEqual({
      steps: 0x1234,
      distanceMeters: 16,
      calories: 42,
    });
    expect(parseBattery(new DataView(Uint8Array.from([0, 83, 1]).buffer))).toEqual({
      batteryPercent: 83,
      charging: true,
    });
  });
});
