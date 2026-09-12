import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ClinicError } from "./consultations.js";
const formats: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav" };
export function validateAudio(bytes: unknown, contentType: string, language: unknown) {
    const mime = contentType.split(";")[0].trim().toLowerCase(), extension = formats[mime];
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 8 * 1024 * 1024 || !extension || !["bn-BD", "bn-IN", "en-US"].includes(String(language)))
      throw new ClinicError("Send a microphone recording up to 8 MB with a supported language.", 400);
    const valid = (mime === "audio/webm" && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) ||
      (mime === "audio/ogg" && bytes.toString("ascii", 0, 4) === "OggS") ||
      (mime === "audio/mp4" && bytes.toString("ascii", 4, 8) === "ftyp") ||
      (mime === "audio/wav" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE");
    if (!valid) throw new ClinicError("The recording does not match its audio format.", 400);
    return { bytes, mime, extension, language: String(language) };
}
export class AudioSamples {
  constructor(private readonly directory: string) {}
  async save(input: unknown, contentType: string, selectedLanguage: unknown) {
    const { bytes, mime, extension, language } = validateAudio(input, contentType, selectedLanguage);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const sample = { id: randomUUID(), mime, extension, language, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), createdAt: new Date().toISOString(), purpose: "owner-requested-model-comparison", comparison: "pending" };
    const file = path.join(this.directory, sample.id);
    await writeFile(file + "." + extension, bytes, { flag: "wx", mode: 0o600 });
    await writeFile(file + ".json.tmp", JSON.stringify(sample), { flag: "wx", mode: 0o600 });
    await rename(file + ".json.tmp", file + ".json");
    return sample;
  }
  async list() {
    const names = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    return Promise.all(names.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name)).map(async (name) => JSON.parse(await readFile(path.join(this.directory, name), "utf8"))));
  }
}
