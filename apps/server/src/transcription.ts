import { createHash } from "node:crypto";
import { ClinicError } from "./consultations.js";
import { validateAudio } from "./audio-samples.js";

export class TranscriptionService {
  private busy = false;
  constructor(private readonly endpoint = process.env.MEDDESK_TRANSCRIPTION_URL) {}
  status() { return { available: Boolean(this.endpoint), languages: ["en-US", "bn-BD", "bn-IN"], maxSeconds: 60 }; }
  async transcribe(input: unknown, type: string, language: unknown, signal?: AbortSignal) {
    const audio = validateAudio(input, type, language);
    if (!this.endpoint) throw new ClinicError("Recorded-audio transcription is not available on this server.", 503);
    if (this.busy) throw new ClinicError("Another recording is being transcribed. Please try again shortly.", 429);
    this.busy = true;
    try {
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), "recording." + audio.extension);
      form.set("response_format", "json");
      form.set("language", audio.language.startsWith("bn") ? "bn" : "en");
      form.set("translate", "false");
      form.set("temperature", "0");
      form.set("temperature_inc", "0");
      const response = await fetch(this.endpoint, { method: "POST", body: form, redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]) });
      if (!response.ok) throw new ClinicError("The recording could not be transcribed. Please try a shorter recording.", 502);
      const result = await response.json() as { text?: unknown };
      if (typeof result.text !== "string" || result.text.length > 20000) throw new ClinicError("The transcription service returned an invalid result.", 502);
      if (!result.text.trim()) throw new ClinicError("No clear speech was detected. Check the microphone level and try again.", 422);
      const letters = [...result.text].filter(character => /\p{L}/u.test(character));
      const allowed = audio.language.startsWith("bn") ? /^[\p{Script=Latin}\p{Script=Bengali}\p{Script=Greek}]$/u : /^[\p{Script=Latin}\p{Script=Greek}]$/u;
      if (letters.some(character => !allowed.test(character)) || /(.)\1{8,}/u.test(result.text))
        throw new ClinicError("The recording could not be recognized reliably in the selected language. Please retry a short, clear phrase.", 422);
      return { text: result.text.trim(), language: audio.language, audioSha256: createHash("sha256").update(audio.bytes).digest("hex") };
    } catch (error) {
      if (error instanceof ClinicError) throw error;
      if (signal?.aborted) throw new ClinicError("Transcription cancelled.", 499);
      throw new ClinicError("Transcription could not finish. Your recording is retained for retry.", 503);
    } finally { this.busy = false; }
  }
}
