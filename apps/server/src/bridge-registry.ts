import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ClinicError } from "./consultations.js";
import { parseReading, type BandReading } from "./reading.js";
import type { NativeBandStatus } from "./band-reader.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class BridgeRegistry {
  private db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA cache_size=-2048;
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, label TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        revoked INTEGER NOT NULL DEFAULT 0, desired INTEGER NOT NULL DEFAULT 1, seen INTEGER NOT NULL DEFAULT 0, status TEXT);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, payload TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS deliveries_device ON deliveries(device_id);`);
  }
  invite(label: unknown) {
    if (typeof label !== "string" || !label.trim() || label.length > 80)
      throw new ClinicError("Enter a computer name of 1–80 characters.", 400);
    this.db.prepare("DELETE FROM invites WHERE expires < ?").run(Date.now());
    if (
      Number(this.db.prepare("SELECT count(*) AS n FROM invites").get()!.n) >=
      20
    )
      throw new ClinicError(
        "Use or wait for an existing enrollment code to expire.",
        429,
      );
    const code = randomBytes(16).toString("hex");
    const expires = Date.now() + 10 * 60_000;
    this.db
      .prepare("INSERT INTO invites VALUES(?,?,?)")
      .run(digest(code), label.trim(), expires);
    return { code, expiresAt: new Date(expires).toISOString() };
  }
  enroll(code: unknown) {
    if (typeof code !== "string" || !/^[a-f0-9]{32}$/.test(code))
      throw new ClinicError("Enrollment code is invalid or expired.", 401);
    const row = this.db
      .prepare("DELETE FROM invites WHERE hash=? AND expires>? RETURNING label")
      .get(digest(code), Date.now());
    if (!row)
      throw new ClinicError("Enrollment code is invalid or expired.", 401);
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO devices(id,label,token_hash) VALUES(?,?,?)")
      .run(id, String(row.label), digest(token));
    return { id, token, label: String(row.label), pollIntervalMs: 10000 };
  }
  authenticate(header: string | undefined) {
    if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header))
      throw new ClinicError("Desktop credential is missing or revoked.", 401);
    const device = this.db
      .prepare("SELECT id FROM devices WHERE token_hash=? AND revoked=0")
      .get(digest(header.slice(7)));
    if (!device)
      throw new ClinicError("Desktop credential is missing or revoked.", 401);
    return String(device.id);
  }
  devices() {
    return this.db
      .prepare(
        "SELECT id,label,revoked,desired,seen FROM devices ORDER BY rowid",
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        label: String(row.label),
        revoked: Boolean(row.revoked),
        desiredRunning: Boolean(row.desired),
        lastSeenAt: row.seen ? new Date(Number(row.seen)).toISOString() : null,
        status: this.status(String(row.id)),
      }));
  }
  status(id: string): NativeBandStatus {
    const row = this.db.prepare("SELECT * FROM devices WHERE id=?").get(id);
    if (!row) throw new ClinicError("Desktop bridge not found.", 404);
    const stored = row.status ? JSON.parse(String(row.status)) : {};
    const online = Date.now() - Number(row.seen) < 35_000 && !row.revoked;
    return {
      available: !row.revoked,
      running: online && stored.running === true,
      phase: online ? stored.phase || "idle" : "offline",
      message: row.revoked
        ? "This computer has been disconnected."
        : online
          ? stored.message || "Desktop bridge connected."
          : "Desktop bridge offline. Open MedDesk Bridge on the paired Windows PC.",
      readings: stored.readings || 0,
      pollIntervalMs: 10000,
      updatedAt: new Date().toISOString(),
      startedAt: stored.startedAt,
      lastReadingAt: stored.lastReadingAt,
      bridgeId: id,
    };
  }
  command(id: string, running: boolean) {
    const result = this.db
      .prepare("UPDATE devices SET desired=? WHERE id=? AND revoked=0")
      .run(Number(running), id);
    if (!result.changes)
      throw new ClinicError("Desktop bridge not found or revoked.", 404);
    return {
      ...this.status(id),
      message: `${running ? "Start" : "Stop"} requested. The desktop will receive it on its next 10-second heartbeat.`,
    };
  }
  revoke(id: string) {
    this.db
      .prepare("UPDATE devices SET revoked=1,desired=0 WHERE id=?")
      .run(id);
  }
  receive(id: string, body: unknown) {
    if (!body || typeof body !== "object")
      throw new ClinicError("Invalid desktop delivery.", 400);
    const { readings, status } = body as {
      readings?: unknown;
      status?: unknown;
    };
    if (!Array.isArray(readings) || readings.length > 100)
      throw new ClinicError("A delivery accepts at most 100 readings.", 400);
    const accepted: string[] = [];
    const batchPayloads = new Map<string, string>();
    const records = readings.map((item) => {
      if (!item || typeof item !== "object" || !uuid.test(item.id))
        throw new ClinicError("Invalid observation identity.", 400);
      const parsed = parseReading(item.reading);
      if (
        !parsed ||
        parsed.source !== "band" ||
        Date.parse(parsed.observedAt) > Date.now() + 60_000
      )
        throw new ClinicError("Invalid band observation or future clock.", 400);
      const payload = JSON.stringify(parsed);
      if (batchPayloads.has(item.id) && batchPayloads.get(item.id) !== payload)
        throw new ClinicError(
          "A batch reuses an observation identity for different data.",
          409,
        );
      batchPayloads.set(item.id, payload);
      // Identity is bound to the enrolled PC; retrying a delivery cannot create a new reading.
      const bytes = createHash("sha1")
        .update(Buffer.from(id.replaceAll("-", ""), "hex"))
        .update(item.id)
        .digest();
      bytes[6] = (bytes[6] & 15) | 80;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = bytes.subarray(0, 16).toString("hex");
      const observationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const reading: BandReading = {
        ...parsed,
        id: observationId,
        bridgeId: id,
        receivedAt: new Date().toISOString(),
      };
      accepted.push(item.id);
      const previous = this.db
        .prepare("SELECT payload FROM deliveries WHERE id=?")
        .get(reading.id);
      if (previous) {
        const saved = JSON.parse(String(previous.payload));
        if (JSON.stringify(parseReading(saved)) !== JSON.stringify(parsed))
          throw new ClinicError(
            "An observation identity cannot be reused for different data.",
            409,
          );
      }
      return reading;
    });
    let safeStatus: Record<string, unknown> = {};
    if (status && typeof status === "object") {
      const s = status as Record<string, unknown>;
      const timestamp = (value: unknown) =>
        typeof value === "string" && Number.isFinite(Date.parse(value))
          ? new Date(value).toISOString()
          : undefined;
      safeStatus = {
        running: s.running === true,
        phase: typeof s.phase === "string" ? s.phase.slice(0, 40) : "idle",
        message: typeof s.message === "string" ? s.message.slice(0, 500) : "",
        readings:
          Number.isSafeInteger(s.readings) && Number(s.readings) >= 0
            ? s.readings
            : 0,
        startedAt: timestamp(s.startedAt),
        lastReadingAt: timestamp(s.lastReadingAt),
      };
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO deliveries(id,device_id,payload) VALUES(?,?,?)",
      );
      for (const reading of records)
        insert.run(reading.id, id, JSON.stringify(reading));
      this.db
        .prepare("UPDATE devices SET seen=?,status=? WHERE id=?")
        .run(Date.now(), JSON.stringify(safeStatus), id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      accepted,
      desiredRunning: Boolean(
        this.db.prepare("SELECT desired FROM devices WHERE id=?").get(id)!
          .desired,
      ),
    };
  }
  pending() {
    return this.db
      .prepare(
        "SELECT payload FROM deliveries WHERE published=0 ORDER BY rowid LIMIT 100",
      )
      .all()
      .map((row) => JSON.parse(String(row.payload)) as BandReading);
  }
  published(id: string) {
    this.db.prepare("UPDATE deliveries SET published=1 WHERE id=?").run(id);
  }
  get(id: string) {
    const row = this.db
      .prepare("SELECT payload FROM deliveries WHERE id=?")
      .get(id);
    return row ? (JSON.parse(String(row.payload)) as BandReading) : undefined;
  }
  latest(id: string, limit: number) {
    return this.db
      .prepare(
        "SELECT payload FROM deliveries WHERE device_id=? ORDER BY rowid DESC LIMIT ?",
      )
      .all(id, limit)
      .map((row) => JSON.parse(String(row.payload)) as BandReading)
      .reverse();
  }
  close() {
    this.db.close();
  }
}
