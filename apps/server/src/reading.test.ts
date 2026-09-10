import assert from "node:assert/strict";
import test from "node:test";
import { parseReading } from "./reading.js";

test("accepts a bounded partial band reading", () => {
  assert.deepEqual(
    parseReading({
      observedAt: "2026-09-11T00:00:00.000Z",
      source: "band",
      deviceName: "Mi Smart Band 5",
      heartRate: 74,
      batteryPercent: 83,
    }),
    {
      observedAt: "2026-09-11T00:00:00.000Z",
      source: "band",
      deviceName: "Mi Smart Band 5",
      heartRate: 74,
      batteryPercent: 83,
    },
  );
});

test("rejects invalid or metric-free payloads", () => {
  assert.equal(parseReading({ observedAt: "bad", source: "band", heartRate: 70 }), null);
  assert.equal(parseReading({ observedAt: new Date().toISOString(), source: "band" }), null);
  assert.equal(
    parseReading({ observedAt: new Date().toISOString(), source: "band", heartRate: 400 }),
    null,
  );
});
