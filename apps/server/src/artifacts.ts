import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ClinicError } from "./consultations.js";

export class ArtifactStore {
  constructor(private readonly directory: string) {}
  async initialize() {
    await mkdir(this.directory, { recursive: true });
  }
  async put(bytes: Buffer, name: string) {
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > 10 * 1024 * 1024
    )
      throw new ClinicError("Choose a file up to 10 MB.", 400);
    const mime =
      bytes.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? "image/jpeg"
            : "";
    if (!mime)
      throw new ClinicError(
        "Only PDF, PNG and JPEG source files are supported.",
        415,
      );
    const id = createHash("sha256").update(bytes).digest("hex");
    const metadata = {
      id,
      name: path.basename(name).slice(0, 200),
      mime,
      size: bytes.length,
      createdAt: new Date().toISOString(),
    };
    await writeFile(path.join(this.directory, `${id}.bin`), bytes, {
      flag: "wx",
      mode: 0o600,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    await writeFile(
      path.join(this.directory, `${id}.json`),
      JSON.stringify(metadata),
      { flag: "wx", mode: 0o600 },
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    return metadata;
  }
  async get(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new ClinicError("Invalid source ID.", 400);
    try {
      const metadata = JSON.parse(
        await readFile(path.join(this.directory, `${id}.json`), "utf8"),
      ) as { id: string; name: string; mime: string; size: number };
      return { ...metadata, file: path.join(this.directory, `${id}.bin`) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
