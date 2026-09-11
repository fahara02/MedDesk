import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrescriptionAssistant } from "./assistant.js";
import { DrugIndex } from "./drug-index.js";
import { MedicineCatalog } from "./catalog.js";
import { parseConsultation } from "./clinical-model.js";

const configuration = {
  MEDDESK_QWEN_API_KEY: "synthetic-test-key",
  MEDDESK_QWEN_BASE_URL:
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  MEDDESK_QWEN_MODEL: "synthetic-model",
};
function draft() {
  return parseConsultation(
    {
      id: crypto.randomUUID(),
      revision: 0,
      patient: {
        id: crypto.randomUUID(),
        name: "Synthetic patient",
        age: "",
        sex: "",
        reference: "",
      },
      clinician: {
        name: "Synthetic prescriber",
        registration: "TEST",
        clinic: "",
      },
      date: "2026-09-12",
      complaints: "Review authored 0.500 mg প্রতিদিন",
      history: "",
      examination: "",
      assessment: "",
      advice: "",
      followUp: "",
      medications: [],
      vitalReadingIds: [],
      sources: [],
      synthetic: true,
    },
    true,
  )!;
}
test("Qwen works with deployment variables without a local LUNA file and rejects a Token Plan endpoint", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "meddesk-qwen-config-"),
  );
  const index = new DrugIndex(path.join(directory, "drugs.sqlite"));
  try {
    const catalog = new MedicineCatalog(directory);
    await catalog.initialize();
    index.initialize(catalog);
    const assistant = new PrescriptionAssistant(
      path.join(directory, "missing.env"),
      index,
      configuration,
    );
    await assistant.initialize();
    assert.equal(assistant.status().configured, true);
    assert.equal(assistant.status().model, "synthetic-model");
    assert.ok(
      !JSON.stringify(assistant.status()).includes(
        configuration.MEDDESK_QWEN_API_KEY,
      ),
    );
    const rejected = new PrescriptionAssistant(
      path.join(directory, "missing.env"),
      index,
      {
        ...configuration,
        MEDDESK_QWEN_BASE_URL: "https://coding-intl.dashscope.aliyuncs.com/v1",
      },
    );
    await rejected.initialize();
    assert.equal(rejected.status().configured, false);
  } finally {
    index.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("Qwen request preserves full authored context, cites retrieved sources, and rejects bad provider results", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "meddesk-qwen-request-"),
  );
  const index = new DrugIndex(path.join(directory, "drugs.sqlite"));
  const originalFetch = globalThis.fetch;
  try {
    await writeFile(
      path.join(directory, "test_products_json_details.csv"),
      'Name,Generic,Description JSON\nSynthetic Zephyr,Synthetic compound,"{""Text"":""Synthetic reference text""}"\n',
    );
    const catalog = new MedicineCatalog(directory);
    await catalog.initialize();
    index.initialize(catalog);
    const assistant = new PrescriptionAssistant(
      path.join(directory, "missing.env"),
      index,
      configuration,
    );
    await assistant.initialize();
    const source = index.search("Zephyr")[0],
      input = draft();
    assert.ok(input);
    let request: Record<string, unknown> | undefined,
      calls = 0;
    let reply: unknown = {
      answer: "Review the authored instructions.",
      proposal: "0.500 mg প্রতিদিন",
      citations: ["document", source.id],
    };
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(
        String(url),
        configuration.MEDDESK_QWEN_BASE_URL + "/chat/completions",
      );
      assert.equal(options?.redirect, "error");
      request = JSON.parse(String(options?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(reply) } }],
        }),
      );
    };
    const before = JSON.stringify(input),
      answer = await assistant.ask({ question: "Review Zephyr", draft: input });
    assert.equal(JSON.stringify(input), before);
    assert.equal(answer.proposal, "0.500 mg প্রতিদিন");
    assert.equal(answer.sources[0].id, source.id);
    assert.match(answer.documentHash, /^[a-f0-9]{64}$/);
    assert.match(JSON.stringify(request), /0\.500 mg প্রতিদিন/);
    reply = {
      answer: "Unknown source",
      proposal: "",
      citations: ["invented-source"],
    };
    await assert.rejects(
      assistant.ask({ question: "Review Zephyr", draft: input }),
      /unsupported answer or citation/,
    );
    reply = null;
    await assert.rejects(
      assistant.ask({ question: "Review Zephyr", draft: input }),
      /unsupported answer or citation/,
    );
    const prior = calls;
    const long = draft();
    long.document = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x".repeat(31000) }],
        },
      ],
    };
    // Use a matching authored document without fabricating structured field defaults.
    const { applyDocument } = await import("./document-projection.js");
    const projected = applyDocument(long, long.document);
    projected.date = "2026-09-12";
    projected.document!.content!.push({
      type: "recordField",
      attrs: { field: "date", label: "Date" },
      content: [{ type: "text", text: projected.date }],
    });
    await assert.rejects(
      assistant.ask({ question: "Review all text", draft: projected }),
      /30,000-character/,
    );
    assert.equal(calls, prior);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: { code: "AllocationQuota.FreeTierOnly" } }),
        { status: 403 },
      );
    await assert.rejects(
      assistant.ask({ question: "Review Zephyr", draft: input }),
      /AllocationQuota.FreeTierOnly/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    index.close();
    await rm(directory, { recursive: true, force: true });
  }
});
