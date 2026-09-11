import { describe, expect, it } from "vitest";
import { mergeReading } from "./display";

describe("measurement display", () => {
  const first = { source: "band" as const, deviceName: "band", heartRate: 72, observedAt: "2026-09-11T00:00:00Z" };
  it("retains the actual heart-rate time across summary packets", () => {
    const display = mergeReading(mergeReading(null, first), {
      source: "band", deviceName: "band", batteryPercent: 80, observedAt: "2026-09-11T00:01:00Z",
    });
    expect(display.heartRate).toBe(72);
    expect(display.heartRateObservedAt).toBe(first.observedAt);
    expect(display.batteryPercent).toBe(80);
  });
  it("does not carry demo or another device's metrics into the current source", () => {
    for (const reading of [
      { source: "demo" as const, deviceName: "band" },
      { source: "band" as const, deviceName: "another band" },
    ]) {
      const display = mergeReading(mergeReading(null, first), { ...reading, batteryPercent: 50, observedAt: first.observedAt });
      expect(display.heartRate).toBeUndefined();
      expect(display.heartRateObservedAt).toBeUndefined();
    }
  });
});
