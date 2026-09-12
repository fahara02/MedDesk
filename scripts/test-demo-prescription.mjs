import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildDemoPdf } from './build-demo-prescription.mjs';
import { demoPrescription } from '../apps/server/src/demo-prescription.ts';
import { parseConsultation } from '../apps/server/src/clinical-model.ts';
import { encodeDemoLps, decodeDemoLps, crc32c, DEMO_LPS_LIMIT } from '../apps/server/src/demo-lps.ts';
import { initialDocument } from '../apps/web/src/lib/document.ts';

test('published sample PDF matches its source fixture and can be rebuilt exactly', async () => {
  const { pdf, sourceSha256 } = await buildDemoPdf();
  const published = await readFile(new URL('../apps/web/public/demo/ayesha-rahman-prescription.pdf', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../apps/web/public/demo/manifest.json', import.meta.url), 'utf8'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual(pdf, published);
  assert.equal(manifest.pdfBytes, pdf.length);
  assert.equal(manifest.pdfSha256, createHash('sha256').update(pdf).digest('hex'));
  assert.equal(manifest.sourceSha256, sourceSha256);
  assert.equal(manifest.pages, 1);
  assert.equal(manifest.nativeLps, false);
});

test('sample is complete fictional data, with no real device evidence or reusable mutable fixture', () => {
  const draft = demoPrescription();
  assert.ok(parseConsultation(draft));
  assert.equal(draft.synthetic, true);
  assert.equal(draft.language, 'en');
  assert.equal(draft.patient.name, 'Ayesha Rahman');
  assert.equal(draft.medications.length, 2);
  assert.deepEqual(draft.vitalReadingIds, []);
  assert.deepEqual(draft.sources, []);
  for (const medicine of draft.medications)
    for (const field of ['name', 'dose', 'strength', 'route', 'frequency', 'duration', 'quantity', 'instructions']) assert.ok(medicine[field]);
  for (const field of ['complaints', 'history', 'examination', 'assessment', 'allergies', 'investigations', 'advice', 'nutrition', 'followUp']) assert.ok(draft[field]);
  draft.medications[0].dose = 'Edited';
  assert.equal(demoPrescription().medications[0].dose, '1 tablet (10 mg)');
});

test('published binary demo LPS round-trips the complete sample and matches the manifest', async () => {
  assert.equal(crc32c(new TextEncoder().encode('123456789')), 0xe3069283);
  const bytes = encodeDemoLps(demoPrescription());
  const published = await readFile(new URL('../apps/web/public/demo/ayesha-rahman-prescription.lps', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../apps/web/public/demo/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(Buffer.from(bytes), published);
  assert.deepEqual(decodeDemoLps(bytes), parseConsultation(demoPrescription(), true));
  assert.equal(manifest.lpsBytes, bytes.length);
  assert.equal(manifest.lpsSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(manifest.demoLps, true);
  assert.equal(manifest.lpsSigned, false);
});

test('demo LPS preserves authored Unicode, exact decimal strings and editor content', () => {
  const draft = demoPrescription();
  draft.medications[0].dose = '0.500 mg';
  draft.advice = 'বাংলা\nLiteral <tag> & text';
  draft.document = initialDocument(draft);
  draft.document.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Extra exact paragraph', marks: [{ type: 'bold' }] }] });
  assert.deepEqual(decodeDemoLps(encodeDemoLps(draft)), parseConsultation(draft, true));
});

test('demo LPS refuses corruption at every byte, every truncation and appended data', () => {
  const original = encodeDemoLps(demoPrescription());
  for (let i = 0; i < original.length; i++) {
    const changed = original.slice(); changed[i] ^= 1;
    assert.throws(() => decodeDemoLps(changed), `corruption at ${i}`);
    assert.throws(() => decodeDemoLps(original.subarray(0, i)), `truncation at ${i}`);
  }
  const trailing = new Uint8Array(original.length + 1); trailing.set(original);
  assert.throws(() => decodeDemoLps(trailing));
  assert.throws(() => decodeDemoLps(new Uint8Array(DEMO_LPS_LIMIT + 1)));
});

test('demo LPS refuses non-demo content, linked authority, and modified framing even with recomputed CRC', () => {
  for (const change of [draft => { draft.synthetic = false; }, draft => { draft.vitalReadingIds = [draft.id]; }, draft => { draft.sources = [{ artifactId: 'a'.repeat(64), name: 'source', fields: ['advice'] }]; }]) {
    const draft = demoPrescription(); change(draft); assert.throws(() => encodeDemoLps(draft));
  }
  for (const index of [20, 22, 24, 28, 30, 31, 32, 34, 36, 44, 48, 49]) {
    const bytes = encodeDemoLps(demoPrescription()); bytes[index] ^= 1;
    new DataView(bytes.buffer).setUint32(52, crc32c(bytes.subarray(8, 52)), true);
    assert.throws(() => decodeDemoLps(bytes), `framing at ${index}`);
  }
});
