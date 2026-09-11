import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { ClinicError } from "./consultations.js";
export interface SpeechVoice {
  name: string;
  language: string;
}
export class SpeechService {
  private voices: SpeechVoice[] = [];
  private busy = false;
  constructor(private readonly script: string) {}
  private run(
    input: string,
    list: boolean,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-File", this.script, ...(list ? ["-ListVoices"] : [])],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      const chunks: Buffer[] = [];
      let size = 0,
        failed = false;
      const stop = () => {
        failed = true;
        child.kill();
      };
      const timeout = setTimeout(stop, list ? 10000 : 60000);
      signal?.addEventListener("abort", stop, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 24 * 1024 * 1024) stop();
        else chunks.push(chunk);
      });
      child.stderr.on("data", () => {});
      child.stdin.on("error", () => {});
      child.once("error", () => {
        failed = true;
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", stop);
        if (failed || code !== 0)
          reject(
            new ClinicError(
              "Speech could not be generated. Check the voice language or shorten the text.",
              502,
            ),
          );
        else resolve(Buffer.concat(chunks));
      });
      child.stdin.end(input);
    });
  }
  async initialize() {
    if (process.platform !== "win32") return;
    try {
      this.voices = JSON.parse(
        (await this.run("", true)).toString("utf8").replace(/^\uFEFF/, ""),
      );
    } catch {
      this.voices = [];
    }
  }
  status() {
    return {
      available: this.voices.length > 0,
      voices: this.voices,
      engine: "Windows installed voices",
    };
  }
  async synthesize(input: unknown, signal?: AbortSignal) {
    const value = input as { text?: unknown; voice?: unknown; rate?: unknown };
    if (
      typeof value?.text !== "string" ||
      !value.text.trim() ||
      value.text.length > 8000 ||
      typeof value.voice !== "string" ||
      !this.voices.some((voice) => voice.name === value.voice)
    )
      throw new ClinicError(
        "Choose an installed voice and text up to 8,000 characters.",
        400,
      );
    const voice = this.voices.find((voice) => voice.name === value.voice)!;
    if (/[\u0980-\u09FF]/.test(value.text) && !voice.language.startsWith("bn"))
      throw new ClinicError(
        "This document contains Bengali. Choose a Bengali voice; the selected Windows voice does not support it.",
        400,
      );
    if (this.busy)
      throw new ClinicError(
        "Speech is already being generated. Wait or cancel it first.",
        409,
      );
    this.busy = true;
    try {
      const audio = await this.run(
        JSON.stringify({
          text: value.text,
          voice: value.voice,
          rate:
            typeof value.rate === "number"
              ? Math.max(-3, Math.min(3, Math.round(value.rate)))
              : 0,
        }),
        false,
        signal,
      );
      if (
        audio.toString("ascii", 0, 4) !== "RIFF" ||
        audio.toString("ascii", 8, 12) !== "WAVE"
      )
        throw new ClinicError("Speech returned an invalid audio file.", 502);
      return {
        audio,
        hash: createHash("sha256").update(value.text).digest("hex"),
      };
    } finally {
      this.busy = false;
    }
  }
}
