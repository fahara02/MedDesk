import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  parseConsultation,
  validId,
  type Consultation,
  type ConsultationInput,
  type ConsultationSummary,
} from "./clinical-model.js";
import type { BandReading } from "./reading.js";

export class ClinicError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class ConsultationStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) {}

  async initialize() {
    await mkdir(this.directory, { recursive: true });
  }

  async get(id: string): Promise<Consultation | null> {
    if (!validId(id)) throw new ClinicError("Invalid consultation ID.", 400);
    try {
      const value = JSON.parse(
        await readFile(path.join(this.directory, `${id}.json`), "utf8"),
      ) as Consultation;
      if (
        !parseConsultation(value) ||
        value.id !== id ||
        !Array.isArray(value.vitals)
      )
        throw new Error("Invalid saved consultation.");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(): Promise<ConsultationSummary[]> {
    const names = (await readdir(this.directory)).filter(
      (name) => name.endsWith(".json") && validId(name.slice(0, -5)),
    );
    const summaries: ConsultationSummary[] = [];
    for (const name of names) {
      const item = await this.get(name.slice(0, -5));
      if (item)
        summaries.push({
          id: item.id,
          revision: item.revision,
          patient: item.patient,
          date: item.date,
          updatedAt: item.updatedAt,
          medicationCount: item.medications.length,
          synthetic: item.synthetic === true,
        });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(
    input: ConsultationInput,
    findReading: (id: string) => BandReading | undefined,
  ): Promise<Consultation> {
    const result = this.queue.then(async () => {
      if (input.synthetic && input.vitalReadingIds.length)
        throw new ClinicError(
          "Real measurements cannot be attached to a fictional patient.",
          400,
        );
      const existing = await this.get(input.id);
      if ((existing?.revision ?? 0) !== input.revision) {
        throw new ClinicError(
          "This consultation changed in another tab. Reopen the saved version before saving again.",
          409,
        );
      }
      if (
        existing &&
        existing.patient.id !== input.patient.id &&
        input.vitalReadingIds.length
      ) {
        throw new ClinicError(
          "Remove attached readings before changing the patient.",
          400,
        );
      }
      const vitals = input.vitalReadingIds.map((id) => {
        const reading =
          existing?.vitals.find((item) => item.id === id) ?? findReading(id);
        if (!reading || reading.source !== "band") {
          throw new ClinicError(
            "Only recorded band measurements can be attached. Refresh the readings and try again.",
            400,
          );
        }
        return { ...reading };
      });
      const now = new Date().toISOString();
      const consultation: Consultation = {
        ...input,
        revision: input.revision + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        vitals,
      };
      const destination = path.join(this.directory, `${input.id}.json`);
      const temporary = path.join(
        this.directory,
        `${input.id}.${crypto.randomUUID()}.tmp`,
      );
      try {
        if (existing) {
          const historyDirectory = path.join(this.directory, input.id);
          await mkdir(historyDirectory, { recursive: true });
          await writeFile(
            path.join(historyDirectory, `${existing.revision}.json`),
            JSON.stringify(existing),
            { flag: "wx", mode: 0o600 },
          ).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          });
        }
        await writeFile(temporary, JSON.stringify(consultation, null, 2), {
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporary, destination);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      return consultation;
    });
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  async history(id: string): Promise<Consultation[]> {
    const current = await this.get(id);
    if (!current) return [];
    const directory = path.join(this.directory, id);
    const names = await readdir(directory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const records: Consultation[] = [];
    for (const name of names
      .filter((item) => /^\d+\.json$/.test(item))
      .sort((a, b) => Number(b.slice(0, -5)) - Number(a.slice(0, -5)))
      .slice(0, 99)) {
      const value = JSON.parse(
        await readFile(path.join(directory, name), "utf8"),
      ) as Consultation;
      if (!parseConsultation(value) || value.id !== id)
        throw new Error("Invalid archived consultation.");
      records.push(value);
    }
    return [current, ...records];
  }
}
