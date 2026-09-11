import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { MedicineCatalog } from "./catalog.js";

export interface DrugSource {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  sourceFile: string;
  sourceHash: string;
  reviewStatus: "unverified-import";
}
export class DrugIndex {
  private db?: DatabaseSync;
  private count = 0;
  constructor(private readonly file: string) {}
  initialize(catalog: MedicineCatalog) {
    this.db = new DatabaseSync(this.file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA cache_size=-4096;
      CREATE TABLE IF NOT EXISTS drug_sources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS catalog_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS drug_fts USING fts5(id UNINDEXED,identity,body,tokenize='unicode61');`);
    const digest = createHash("sha256");
    for (const row of catalog.entries())
      digest.update(row.id).update(JSON.stringify(row.sourceText));
    const fingerprint = digest.digest("hex");
    const previous = this.db
      .prepare("SELECT value FROM catalog_meta WHERE key='fingerprint'")
      .get();
    this.count = catalog.status().count;
    if (previous?.value === fingerprint) return;
    const insert = this.db.prepare("INSERT INTO drug_sources VALUES(?,?)");
    const index = this.db.prepare(
      "INSERT INTO drug_fts(id,identity,body) VALUES(?,?,?)",
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM drug_sources; DELETE FROM drug_fts");
      for (const row of catalog.entries()) {
        const body = Object.entries(row.sourceText)
          .map(
            ([key, value]) =>
              `${key}: ${value
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/g, " ")
                .replace(/\s+/g, " ")}`,
          )
          .join("\n");
        insert.run(row.id, JSON.stringify(row));
        index.run(
          row.id,
          `${row.name} ${row.generic} ${row.strength} ${row.form} ${row.manufacturer}`,
          body,
        );
      }
      this.db
        .prepare("INSERT OR REPLACE INTO catalog_meta VALUES('fingerprint',?)")
        .run(fingerprint);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  status() {
    return {
      ready: !!this.db,
      products: this.count,
      method: "SQLite FTS5 / BM25",
      source: "root data CSV files",
    };
  }
  search(query: string, selected: string[] = []): DrugSource[] {
    if (!this.db) return [];
    const sources = new Map<string, DrugSource>();
    const add = (id: string, excerpt?: string) => {
      const row = this.db!.prepare(
        "SELECT payload FROM drug_sources WHERE id=?",
      ).get(id);
      if (!row) return;
      const medicine = JSON.parse(String(row.payload));
      sources.set(id, {
        id,
        title: `${medicine.name} ${medicine.strength} · ${medicine.generic}`,
        excerpt:
          excerpt ||
          Object.entries(medicine.sourceText)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
            .replace(/<[^>]+>/g, " ")
            .slice(0, 2400),
        url: medicine.url,
        sourceFile: medicine.sourceFile,
        sourceHash: id,
        reviewStatus: "unverified-import",
      });
    };
    for (const id of selected.slice(0, 4)) add(id);
    const terms = [
      ...new Set(query.toLowerCase().match(/[\p{L}\p{M}\p{N}]{2,}/gu) || []),
    ].slice(0, 20);
    if (terms.length) {
      const matches = this.db
        .prepare(
          "SELECT id,snippet(drug_fts,2,'','',' … ',96) AS excerpt FROM drug_fts WHERE drug_fts MATCH ? ORDER BY bm25(drug_fts,0,8,1) LIMIT 8",
        )
        .all(terms.map((term) => `"${term}"`).join(" OR "));
      for (const match of matches) {
        if (sources.size >= 8) break;
        if (!sources.has(String(match.id)))
          add(String(match.id), String(match.excerpt));
      }
    }
    return [...sources.values()];
  }
  close() {
    this.db?.close();
    this.db = undefined;
  }
}
