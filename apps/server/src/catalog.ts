import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parse } from "csv-parse";

export interface Medicine {
  id: string;
  name: string;
  generic: string;
  strength: string;
  form: string;
  manufacturer: string;
  url: string;
  unitPrice: string;
  packSize: string;
  sourceFile: string;
  sourceModifiedAt: string;
}

export interface MedicineDetails extends Medicine {
  sourceText: Record<string, string>;
  reviewStatus: "unverified-import";
}

export class MedicineCatalog {
  private rows = new Map<string, MedicineDetails>();
  private searchText = new Map<string, string>();
  readonly issues: string[] = [];
  private files = 0;
  constructor(private readonly directory: string) {}

  async initialize() {
    const names = await readdir(this.directory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    let totalBytes = 0;
    for (const name of names
      .filter((file) => file.endsWith("_products_json_details.csv"))
      .sort()) {
      const file = path.join(this.directory, name);
      const info = await stat(file);
      totalBytes += info.size;
      if (info.size > 16 * 1024 * 1024 || totalBytes > 128 * 1024 * 1024) {
        this.issues.push(`${name}: import size limit exceeded.`);
        continue;
      }
      const imported: MedicineDetails[] = [];
      const input = createReadStream(file);
      const parser = input.pipe(
        parse({
          columns: true,
          bom: true,
          skip_empty_lines: true,
          max_record_size: 256 * 1024,
        }),
      );
      input.on("error", (error) => parser.destroy(error));
      try {
        let index = 0;
        for await (const raw of parser) {
          index += 1;
          const row = raw as Record<string, string>;
          if (!row.Name?.trim()) continue;
          if (this.rows.size + imported.length >= 50_000)
            throw new Error("Catalog row limit exceeded.");
          const sourceText: Record<string, string> = {};
          const descriptionText =
            row["Description JSON"] || row.Description || "{}";
          try {
            const description: unknown = JSON.parse(descriptionText);
            if (
              description &&
              typeof description === "object" &&
              !Array.isArray(description)
            ) {
              const retain = (value: unknown, key: string, depth: number) => {
                if (typeof value === "string") sourceText[key] = value;
                else if (value && typeof value === "object" && depth < 5)
                  for (const [nested, item] of Object.entries(value))
                    retain(item, `${key}.${nested}`, depth + 1);
              };
              for (const [key, value] of Object.entries(description))
                retain(value, key, 0);
            }
          } catch {
            sourceText["Unparsed source text"] = descriptionText;
          }
          let url = "";
          try {
            const parsed = new URL(row.URL);
            if (parsed.protocol === "https:") url = parsed.href;
          } catch {}
          imported.push({
            id: createHash("sha256")
              .update(`${name}\n${index}\n${JSON.stringify(row)}`)
              .digest("hex"),
            name: row.Name,
            generic: row.Generic || "",
            strength: row.Strength || "",
            form: row.Type || "",
            manufacturer: row.Manufacturer || "",
            url,
            unitPrice: row["Unit Price"] || "",
            packSize: row["Pack Size"] || "",
            sourceFile: name,
            sourceModifiedAt: info.mtime.toISOString(),
            sourceText,
            reviewStatus: "unverified-import",
          });
        }
        for (const medicine of imported) {
          this.rows.set(medicine.id, medicine);
          this.searchText.set(
            medicine.id,
            `${medicine.name} ${medicine.generic} ${medicine.strength} ${medicine.form} ${medicine.manufacturer}`.toLocaleLowerCase(),
          );
        }
        this.files += 1;
      } catch {
        this.issues.push(
          `${name}: could not import the complete CSV; its rows were not loaded.`,
        );
      } finally {
        input.destroy();
        parser.destroy();
      }
    }
  }

  status() {
    return {
      count: this.rows.size,
      files: this.files,
      issues: [...this.issues],
      reviewStatus: "unverified-import",
    };
  }

  search(query: string): Medicine[] {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (query.trim().length < 2) return [];
    const result: Medicine[] = [];
    for (const [id, value] of this.searchText) {
      if (terms.every((term) => value.includes(term))) {
        const {
          sourceText: _text,
          reviewStatus: _review,
          ...summary
        } = this.rows.get(id)!;
        result.push(summary);
        if (result.length === 30) break;
      }
    }
    return result;
  }

  get(id: string) {
    return this.rows.get(id);
  }

  entries() {
    return this.rows.values();
  }
}
