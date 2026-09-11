import assert from "node:assert/strict";
import test from "node:test";
import { parseSleepSummaries } from "./sleep.js";

test("sleep decoding preserves only recorded stages and does not turn missing data into zero sleep", () => {
  const st = 1789156800;
  const row = (slp: unknown) => ({
    date_time: "2026-09-12",
    summary: Buffer.from(JSON.stringify({ slp })).toString("base64"),
  });
  const [session] = parseSleepSummaries([
    row({ st, ed: st + 8 * 3600, dp: 90, lt: 360, ss: 82 }),
  ]);
  assert.equal(session.deepMinutes, 90);
  assert.equal(session.lightMinutes, 360);
  assert.equal(session.restingHeartRate, undefined);
  assert.equal(session.source, "zepp-account");
  assert.match(session.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(
    parseSleepSummaries([row({ st, ed: st + 3600 })])[0].deepMinutes,
    undefined,
  );
  assert.deepEqual(
    parseSleepSummaries([
      row({ st: 0, ed: 0 }),
      row({ st, ed: st - 1 }),
      { summary: "bnVsbA==" },
      null,
      { summary: "bad" },
    ]),
    [],
  );
  assert.deepEqual(parseSleepSummaries([]), []);
});
