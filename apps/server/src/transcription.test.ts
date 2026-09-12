import test from "node:test";
import assert from "node:assert/strict";
import { TranscriptionService } from "./transcription.js";

const recording = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 1]);
test("transcription forwards exact audio and selected language without clinical context or translation", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://speech.test/inference");
    const form = options!.body as FormData;
    assert.equal(form.get("language"), "bn"); assert.equal(form.get("translate"), "false");
    assert.equal(form.get("prompt"), null);
    assert.deepEqual(Buffer.from(await (form.get("file") as Blob).arrayBuffer()), recording);
    return Response.json({ text: "  0.500 mg প্রতিদিন  " });
  });
  const result = await new TranscriptionService("http://speech.test/inference").transcribe(recording, "audio/webm;codecs=opus", "bn-BD");
  assert.equal(result.text, "0.500 mg প্রতিদিন"); assert.equal(result.language, "bn-BD");
  assert.equal(result.audioSha256.length, 64);
});

test("transcription refuses invalid recordings and empty or invalid upstream results", async t => {
  const service = new TranscriptionService("http://speech.test/inference");
  await assert.rejects(service.transcribe(Buffer.from("wrong"), "audio/webm", "en-US"), /format/);
  await assert.rejects(service.transcribe(recording, "audio/webm", "unknown"), /supported language/);
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ text: "" }));
  await assert.rejects(service.transcribe(recording, "audio/webm", "en-US"), /No clear speech/);
  mock.mock.mockImplementation(async () => Response.json({ text: 42 }));
  await assert.rejects(service.transcribe(recording, "audio/webm", "en-US"), /invalid result/);
  mock.mock.mockImplementation(async () => Response.json({ text: "ༀༀༀༀༀༀༀༀༀༀༀ" }));
  await assert.rejects(service.transcribe(recording, "audio/webm", "bn-BD"), /could not be recognized reliably/);
  mock.mock.mockImplementation(async () => new Response("private internal error", { status: 500 }));
  await assert.rejects(service.transcribe(recording, "audio/webm", "en-US"), /could not be transcribed/);
});

test("one transcription runs at a time and cancellation permits a later retry", async t => {
  const service = new TranscriptionService("http://speech.test/inference"), abort = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  }));
  const pending = service.transcribe(recording, "audio/webm", "en-US", abort.signal);
  await assert.rejects(service.transcribe(recording, "audio/webm", "en-US"), /Another recording/);
  abort.abort(); await assert.rejects(pending, /cancelled/);
  t.mock.method(globalThis, "fetch", async () => Response.json({ text: "Retry succeeded" }));
  assert.equal((await service.transcribe(recording, "audio/webm", "en-US")).text, "Retry succeeded");
});
