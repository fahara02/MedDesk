import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AudioSamples } from "./audio-samples.js";
test("voice samples preserve exact private audio and reject mismatched formats", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meddesk-audio-"));
  try {
    const samples = new AudioSamples(directory);
    const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
    await assert.rejects(samples.save(audio, "audio/wav", "bn-BD"), /does not match/);
    await assert.rejects(samples.save(audio, "audio/webm", "arbitrary"), /supported language/);
    const saved = await samples.save(audio, "audio/webm;codecs=opus", "bn-BD");
    assert.deepEqual(await readFile(path.join(directory, saved.id + ".webm")), audio);
    assert.equal(saved.comparison, "pending");
    assert.equal((await samples.list()).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
