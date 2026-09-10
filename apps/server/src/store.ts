import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BandReading } from "./reading.js";

const MAX_MEMORY_READINGS = 2_000;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultDataFile = path.join(repositoryRoot, "data", "readings.jsonl");

export class ReadingStore {
  private readonly dataFile: string;
  private readings: BandReading[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataFile = process.env.MEDDESK_DATA_FILE || defaultDataFile) {
    this.dataFile = path.resolve(dataFile);
  }

  async initialize() {
    await mkdir(path.dirname(this.dataFile), { recursive: true });
    try {
      const contents = await readFile(this.dataFile, "utf8");
      this.readings = contents
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as BandReading];
          } catch {
            return [];
          }
        })
        .slice(-MAX_MEMORY_READINGS);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async add(reading: BandReading) {
    this.readings.push(reading);
    this.readings = this.readings.slice(-MAX_MEMORY_READINGS);

    this.writeQueue = this.writeQueue.then(() =>
      appendFile(this.dataFile, `${JSON.stringify(reading)}\n`, "utf8"),
    );
    await this.writeQueue;
  }

  latest(limit: number) {
    return this.readings.slice(-limit);
  }
}
