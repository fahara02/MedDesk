import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { ClinicError } from "./consultations.js";
export interface SpeechVoice {
  name: string;
  language: string;
  engine?: "windows" | "espeak-ng";
}
export class SpeechService {
  private voices: SpeechVoice[] = [];
  private busy = false;
  private readonly espeak: string;
  private readonly espeakPath: string | undefined;
  constructor(private readonly script: string) {
    const built = path.resolve(
      path.dirname(script),
      "runtime/speech-source/build",
    );
    const executable = path.join(built, "src", "espeak-ng.exe");
    this.espeak =
      process.env.MEDDESK_ESPEAK_EXECUTABLE ||
      (process.platform === "win32" && existsSync(executable)
        ? executable
        : "espeak-ng");
    this.espeakPath =
      process.env.MEDDESK_ESPEAK_DATA_PATH ||
      (this.espeak === executable ? built : undefined);
  }
  private run(
    input: string,
    list: boolean,
    signal?: AbortSignal,
    offlineArgs?: string[],
  ): Promise<Buffer> {
    if (signal?.aborted)
      return Promise.reject(new ClinicError("Speech request cancelled.", 499));
    return new Promise((resolve, reject) => {
      const child = spawn(
        offlineArgs ? this.espeak : "powershell.exe",
        offlineArgs
          ? [
              ...(this.espeakPath ? ["--path=" + this.espeakPath] : []),
              ...offlineArgs,
            ]
          : [
              "-NoProfile",
              "-File",
              this.script,
              ...(list ? ["-ListVoices"] : []),
            ],
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
    this.voices = [];
    if (process.platform === "win32") {
      try {
        this.voices = JSON.parse(
          (await this.run("", true)).toString("utf8").replace(/^\uFEFF/, ""),
        );
      } catch {}
    }
    try {
      const listing = (
        await this.run("", true, undefined, ["--voices"])
      ).toString("utf8");
      for (const [code, label] of [
        ["bn", "Bengali"],
        ["en-us", "English"],
      ] as const) {
        if (
          listing
            .split(/\r?\n/)
            .some((line) => line.trim().split(/\s+/)[1] === code)
        )
          this.voices.push({
            name: `${label} · offline eSpeak NG`,
            language: code,
            engine: "espeak-ng",
          });
      }
    } catch {}
  }
  status() {
    return {
      available: this.voices.length > 0,
      voices: this.voices,
      engine: "Installed speech engines",
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
        "This document contains Bengali. Choose a Bengali voice; the selected voice does not support it.",
        400,
      );
    if (this.busy)
      throw new ClinicError(
        "Speech is already being generated. Wait or cancel it first.",
        409,
      );
    this.busy = true;
    try {
      const offline = voice.engine === "espeak-ng";
      const audio = await this.run(
        offline
          ? value.text
          : JSON.stringify({
              text: value.text,
              voice: value.voice,
              rate:
                typeof value.rate === "number"
                  ? Math.max(-3, Math.min(3, Math.round(value.rate)))
                  : 0,
            }),
        false,
        signal,
        offline
          ? [
              "--stdout",
              "--stdin",
              "-v",
              voice.language,
              "-s",
              String(
                175 +
                  (typeof value.rate === "number"
                    ? Math.max(-3, Math.min(3, Math.round(value.rate))) * 20
                    : 0),
              ),
            ]
          : undefined,
      );
      if (
        audio.toString("ascii", 0, 4) !== "RIFF" ||
        audio.toString("ascii", 8, 12) !== "WAVE"
      )
        throw new ClinicError("Speech returned an invalid audio file.", 502);
      if (offline) {
        // CLI streaming WAV uses an unknown-length header. The returned artifact
        // has a known length, so finalize its RIFF/data sizes for browser seeking.
        let found = false;
        for (let offset = 12; offset + 8 <= audio.length && !found; ) {
          const size = audio.readUInt32LE(offset + 4);
          if (audio.toString("ascii", offset, offset + 4) === "data") {
            audio.writeUInt32LE(audio.length - offset - 8, offset + 4);
            found = true;
          } else offset += 8 + size + (size & 1);
        }
        if (!found)
          throw new ClinicError(
            "Speech returned an incomplete audio file.",
            502,
          );
        audio.writeUInt32LE(audio.length - 8, 4);
      }
      return {
        audio,
        hash: createHash("sha256").update(value.text).digest("hex"),
      };
    } finally {
      this.busy = false;
    }
  }
}
