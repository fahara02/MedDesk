import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { BandReading } from "./reading.js";

export class BridgeQueue {
  private db: DatabaseSync;
  constructor(
    file: string,
    private readonly limit = 30_000,
  ) {
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA cache_size=-2048; CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY,payload TEXT NOT NULL);",
    );
  }
  add(reading: Omit<BandReading, "id" | "receivedAt">) {
    if (this.count() >= this.limit)
      throw new Error(
        "Offline queue is full. Restore the server connection before collecting more readings.",
      );
    this.db
      .prepare("INSERT INTO queue VALUES(?,?)")
      .run(randomUUID(), JSON.stringify(reading));
  }
  batch() {
    return this.db
      .prepare("SELECT id,payload FROM queue ORDER BY rowid LIMIT 100")
      .all()
      .map((row) => ({
        id: String(row.id),
        reading: JSON.parse(String(row.payload)),
      }));
  }
  acknowledge(ids: string[]) {
    this.db.exec("BEGIN");
    try {
      const remove = this.db.prepare("DELETE FROM queue WHERE id=?");
      for (const id of ids) remove.run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  count() {
    return Number(this.db.prepare("SELECT count(*) AS n FROM queue").get()!.n);
  }
  close() {
    this.db.close();
  }
}
