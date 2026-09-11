import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MedicineCatalog } from "./catalog.js";
import { DrugIndex } from "./drug-index.js";
import { parseDocument, documentText } from "./document-model.js";
import { SpeechService } from "./speech.js";
import { PrescriptionAssistant } from "./assistant.js";

test("drug index seeds every source row, searches source details, and retains exact references across reopen", async () => {
  const root = path.resolve(os.tmpdir()),
    directory = await mkdtemp(path.join(root, "meddesk-drugs-"));
  let index: DrugIndex | undefined;
  try {
    await writeFile(
      path.join(directory, "test_products_json_details.csv"),
      'Name,Generic,Description\nTest tablet,Test compound,"{""Mechanism"":""Synthetic retrieval marker zephyr""}"\nOther tablet,Other compound,{}\n',
    );
    await writeFile(
      path.join(directory, "nested_products_json_details.csv"),
      'Name,Generic,Description JSON\nNested tablet,Other compound,"{""Details"":{""Text"":""Synthetic nested marker marigold""}}"\n',
    );
    const catalog = new MedicineCatalog(directory);
    await catalog.initialize();
    index = new DrugIndex(path.join(directory, "medicines.sqlite"));
    index.initialize(catalog);
    assert.equal(index.status().products, 3);
    assert.match(index.search("marigold")[0].excerpt, /marigold/);
    const [source] = index.search("zephyr");
    assert.equal(source.title, "Test tablet  · Test compound");
    assert.match(source.excerpt, /zephyr/);
    assert.equal(source.sourceFile, "test_products_json_details.csv");
    assert.match(source.sourceHash, /^[a-f0-9]{64}$/);
    index.close();
    index = new DrugIndex(path.join(directory, "medicines.sqlite"));
    index.initialize(catalog);
    assert.deepEqual(index.search("zephyr"), [source]);
    assert.deepEqual(index.search('" OR * DROP TABLE'), []);
    const assistant = new PrescriptionAssistant(
      path.join(directory, "missing.env"),
      index,
    );
    await assistant.initialize();
    assert.equal(assistant.status().configured, false);
  } finally {
    index?.close();
    assert.equal(path.dirname(directory), root);
    await rm(directory, { recursive: true, force: true });
  }
});
test("rich documents preserve formatted exact text and reject active images, unknown nodes, and excessive nesting", () => {
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "0.500 mg প্রতিদিন",
            marks: [{ type: "bold" }],
          },
        ],
      },
      {
        type: "signature",
        attrs: {
          src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          signer: "Synthetic doctor",
          width: 180,
          align: "right",
        },
      },
    ],
  };
  assert.deepEqual(parseDocument(document), document);
  assert.equal(
    parseDocument({
      type: "doc",
      content: [{ type: "text", text: "outside a paragraph" }],
    }),
    null,
  );
  assert.equal(
    parseDocument({
      type: "doc",
      content: [
        { type: "recordField", attrs: { field: "patient.name" } },
        { type: "recordField", attrs: { field: "patient.name" } },
      ],
    }),
    null,
  );
  assert.match(documentText(document), /0\.500 mg প্রতিদিন/);
  assert.equal(
    parseDocument({ type: "doc", content: [{ type: "script", text: "bad" }] }),
    null,
  );
  assert.equal(
    parseDocument({
      type: "doc",
      content: [
        { type: "signature", attrs: { src: "https://remote.invalid/image" } },
      ],
    }),
    null,
  );
  let nested: unknown = { type: "paragraph" };
  for (let i = 0; i < 30; i++)
    nested = { type: "blockquote", content: [nested] };
  assert.equal(parseDocument({ type: "doc", content: [nested] }), null);
});
test(
  "Windows speech produces a real WAV from synthetic text and refuses an unavailable voice language",
  { skip: process.platform !== "win32", timeout: 20000 },
  async () => {
    const speech = new SpeechService(
      path.resolve("../../synthesize-speech.ps1"),
    );
    await speech.initialize();
    const voices = speech.status().voices;
    assert.ok(voices.length);
    const result = await speech.synthesize({
      text: "This is a synthetic prescription editor speech test.",
      voice: voices[0].name,
    });
    assert.equal(result.audio.toString("ascii", 0, 4), "RIFF");
    assert.equal(result.audio.toString("ascii", 8, 12), "WAVE");
    assert.ok(result.audio.length > 10000);
    assert.match(result.hash, /^[a-f0-9]{64}$/);
    if (!voices[0].language.startsWith("bn"))
      await assert.rejects(
        speech.synthesize({ text: "পরীক্ষা", voice: voices[0].name }),
        /Bengali/,
      );
  },
);
