import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConsultationStore } from "./consultations.js";
import { parseConsultation, type ConsultationInput } from "./clinical-model.js";
import { MedicineCatalog } from "./catalog.js";
import { ArtifactStore } from "./artifacts.js";
import { ReadingStore } from "./store.js";
import { finalizeReading } from "./reading.js";

function draft(): ConsultationInput {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    patient: {
      id: crypto.randomUUID(),
      name: "Synthetic test patient",
      age: "32 years",
      sex: "",
      reference: "হাসপাতাল-০০১",
    },
    clinician: {
      name: "Test prescriber",
      registration: "TEST",
      clinic: "Test clinic",
    },
    date: "2026-09-12",
    complaints: "",
    history: "",
    examination: "",
    assessment: "",
    advice: "",
    followUp: "",
    medications: [
      {
        id: crypto.randomUUID(),
        catalogId: "",
        name: "Test medicine",
        generic: "",
        strength: "0.50 mg",
        form: "",
        dose: "0.500 mg",
        route: "As authored",
        frequency: "প্রতিদিন",
        duration: "Authored duration",
        quantity: "",
        instructions: "Do not change 0.500 to 0.5.",
      },
    ],
    vitalReadingIds: [],
    allergies: "",
    investigations: "",
    nutrition: "",
    synthetic: true,
    manualVitals: {
      bloodPressure: "",
      pulse: "",
      temperature: "",
      weight: "",
      spo2: "",
    },
    sources: [],
  };
}
async function fixture(run: (directory: string) => Promise<void>) {
  const base = path.resolve(os.tmpdir()),
    directory = await mkdtemp(path.join(base, "meddesk-test-"));
  try {
    await run(directory);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), base);
    await rm(directory, { recursive: true, force: true });
  }
}

test("consultations retain exact decimal strings, Unicode and missingness", () => {
  const input = draft();
  const parsed = parseConsultation(input)!;
  assert.equal(parsed.medications[0].dose, "0.500 mg");
  assert.equal(parsed.medications[0].frequency, "প্রতিদিন");
  assert.equal(parsed.patient.reference, "হাসপাতাল-০০১");
  assert.equal(parsed.allergies, "");
  assert.equal(
    parseConsultation({
      ...input,
      medications: [{ ...input.medications[0], dose: 0.5 }],
    }),
    null,
  );
  assert.equal(parseConsultation({ ...input, date: "2026-02-30" }), null);
  assert.equal(
    parseConsultation({
      ...input,
      medications: [input.medications[0], input.medications[0]],
    }),
    null,
  );
  assert.equal(
    parseConsultation({ ...input, patient: { ...input.patient, name: "" } }),
    null,
  );
  assert.ok(
    parseConsultation(
      { ...input, patient: { ...input.patient, name: "" } },
      true,
    ),
  );
});
test("save, reopen, revision history and optimistic conflicts preserve the saved record", () =>
  fixture(async (directory) => {
    const store = new ConsultationStore(directory);
    await store.initialize();
    const input = draft();
    const first = await store.save(input, () => undefined);
    assert.equal(first.revision, 1);
    const second = await store.save(
      { ...first, advice: "Reviewed advice" },
      () => undefined,
    );
    assert.equal(second.revision, 2);
    await assert.rejects(
      store.save({ ...first, advice: "Stale update" }, () => undefined),
      /changed in another tab/,
    );
    assert.equal((await store.get(input.id))!.advice, "Reviewed advice");
    const revisions = await store.history(input.id);
    assert.deepEqual(
      revisions.map((r) => r.revision),
      [2, 1],
    );
    assert.equal(revisions[1].advice, "");
    const reopened = new ConsultationStore(directory);
    assert.equal(
      (await reopened.get(input.id))!.medications[0].dose,
      "0.500 mg",
    );
    const third = await store.save(
      { ...second, advice: "After failed save" },
      () => undefined,
    );
    assert.equal(third.revision, 3);
  }));
test("band evidence refuses demo readings, fictional patients and patient reassignment", () =>
  fixture(async (directory) => {
    const store = new ConsultationStore(directory);
    await store.initialize();
    const input = draft();
    const reading = finalizeReading({
      source: "band",
      observedAt: "2026-09-12T00:00:00.000Z",
      heartRate: 72,
    });
    await assert.rejects(
      store.save({ ...input, vitalReadingIds: [reading.id] }, () => reading),
      /fictional patient/,
    );
    const real = { ...input, synthetic: false, vitalReadingIds: [reading.id] };
    await assert.rejects(
      store.save(real, () => ({ ...reading, source: "demo" })),
      /Only recorded band/,
    );
    const saved = await store.save(real, () => reading);
    await assert.rejects(
      store.save(
        { ...saved, patient: { ...saved.patient, id: crypto.randomUUID() } },
        () => reading,
      ),
      /Remove attached readings/,
    );
    const retained = await store.save(
      { ...saved, advice: "Another edit" },
      () => undefined,
    );
    assert.equal(retained.vitals[0].observedAt, reading.observedAt);
  }));
test("failed reading writes stay out of memory and do not poison the write queue", () =>
  fixture(async (directory) => {
    const store = new ReadingStore(
      path.join(directory, "missing", "readings.jsonl"),
    );
    const sample = finalizeReading({
      source: "band",
      observedAt: "2026-09-12T00:00:00.000Z",
      batteryPercent: 80,
    });
    await assert.rejects(store.add(sample));
    assert.equal(store.latest(10).length, 0);
    await store.initialize();
    await store.add(sample);
    assert.equal(store.latest(10).length, 1);
  }));
test("catalog loads exact product candidates without manufacturing safety conclusions", () =>
  fixture(async (directory) => {
    const header =
      "Name,Strength,Generic,Type,Manufacturer,URL,Unit Price,Pack Size,Description\n";
    await writeFile(
      path.join(directory, "test_products_json_details.csv"),
      header +
        'TestBrand,0.50 mg,TestGeneric,Tablet,TestCompany,https://example.invalid/product,1,10,"{""source_note"":""Unreviewed text""}"\n',
    );
    await writeFile(
      path.join(directory, "broken_products_json_details.csv"),
      header + 'Partial,1,Example,Tablet,Company,,,,{}\n"unterminated',
    );
    const catalog = new MedicineCatalog(directory);
    await catalog.initialize();
    assert.equal(catalog.status().count, 1);
    assert.equal(catalog.status().issues.length, 1);
    assert.equal(catalog.search("TestGeneric 0.50")[0].name, "TestBrand");
    assert.equal(catalog.search("Partial").length, 0);
    assert.equal(
      catalog.get(catalog.search("TestBrand")[0].id)!.reviewStatus,
      "unverified-import",
    );
  }));
test("source artifacts retain original bytes and reject unsupported types and paths", () =>
  fixture(async (directory) => {
    const store = new ArtifactStore(directory);
    await store.initialize();
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
      "base64",
    );
    const artifact = await store.put(bytes, "source.png");
    const saved = await store.get(artifact.id);
    assert.ok(saved);
    assert.deepEqual(await readFile(saved.file), bytes);
    await assert.rejects(
      store.put(Buffer.from("<html>bad</html>"), "source.png"),
      /Only PDF/,
    );
    await assert.rejects(store.get("../private"), /Invalid source/);
  }));
