import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

test(
  "HTTP workspace retains exact drafts and sources across restart, refuses conflicts, and serves its UI",
  { timeout: 30000 },
  async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const temporaryRoot = path.resolve(os.tmpdir());
    const directory = await mkdtemp(path.join(temporaryRoot, "meddesk-api-"));
    const listener = net.createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    let child;
    let output = "";
    async function stop() {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    }
    async function start() {
      child = spawn(process.execPath, ["apps/server/dist/index.js"], {
        cwd: root,
        env: {
          ...process.env,
          PORT: String(port),
          MEDDESK_DATA_DIR: directory,
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (data) => {
        output = (output + data).slice(-3000);
      });
      child.stderr.on("data", (data) => {
        output = (output + data).slice(-3000);
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null)
          throw new Error(`Test server exited: ${output}`);
        try {
          if ((await fetch(`${base}/api/health`)).ok) return;
        } catch {}
        await delay(50);
      }
      throw new Error(`Test server did not start: ${output}`);
    }
    async function json(route, options, status = 200) {
      const response = await fetch(base + route, options);
      assert.equal(response.status, status, route);
      return response.json();
    }
    const put = (value) => ({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const id = crypto.randomUUID();
    const draft = {
      id,
      revision: 0,
      patient: {
        id: crypto.randomUUID(),
        name: "Synthetic HTTP test",
        age: "32 years",
        sex: "",
        reference: "TEST",
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
          name: "Test product",
          generic: "",
          strength: "",
          form: "",
          dose: "0.500 mg",
          route: "",
          frequency: "প্রতিদিন",
          duration: "",
          quantity: "",
          instructions: "",
        },
      ],
      vitalReadingIds: [],
      synthetic: true,
    };
    try {
      await writeFile(
        path.join(directory, "test_products_json_details.csv"),
        "Name,Generic,Strength,Manufacturer\nTest product,Test generic,0.50 mg,Test manufacturer\n",
      );
      await start();
      const capabilities = await json("/api/capabilities");
      assert.equal(capabilities.nativeLps, false);
      assert.equal(capabilities.assistant, false);
      assert.equal(capabilities.medicineCatalog.count, 1);
      assert.equal(
        (await json("/api/medicines/search?q=Test")).medicines.length,
        1,
      );
      assert.deepEqual((await json("/api/readings")).readings, []);
      assert.equal((await json("/api/band/status")).pollIntervalMs, 10000);
      assert.equal((await json("/api/sleep")).status, "not-synced");
      const streams = [];
      async function subscribe() {
        const controller = new AbortController();
        const response = await fetch(base + "/api/events", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(5000),
          ]),
        });
        assert.match(
          response.headers.get("content-type"),
          /text\/event-stream/,
        );
        const reader = response.body.getReader();
        streams.push({ controller, reader });
        let buffered = "";
        const decoder = new TextDecoder();
        return async function nextEvent(name) {
          while (true) {
            const boundary = buffered.indexOf("\n\n");
            if (boundary !== -1) {
              const frame = buffered.slice(0, boundary);
              buffered = buffered.slice(boundary + 2);
              if (frame.split("\n").includes("event: " + name))
                return JSON.parse(
                  frame
                    .split("\n")
                    .find((line) => line.startsWith("data: "))
                    .slice(6),
                );
            } else {
              const { value, done } = await reader.read();
              assert.equal(done, false, "SSE stays open");
              buffered += decoder.decode(value, { stream: true });
            }
          }
        };
      }
      try {
        const firstStream = await subscribe(),
          secondStream = await subscribe();
        await firstStream("ready");
        await secondStream("ready");
        assert.equal((await firstStream("band-status")).running, false);
        const incoming = {
          source: "demo",
          observedAt: new Date(Date.now() - 10000).toISOString(),
          heartRate: 81,
        };
        const { reading } = await json(
          "/api/readings",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(incoming),
          },
          201,
        );
        assert.deepEqual(await firstStream("reading"), reading);
        assert.deepEqual(await secondStream("reading"), reading);
        assert.equal(reading.observedAt, incoming.observedAt);
        assert.deepEqual((await json("/api/readings")).readings, [reading]);
        streams[0].controller.abort();
        const reconnected = await subscribe();
        await reconnected("ready");
        assert.deepEqual((await json("/api/readings")).readings, [reading]);
        assert.equal(
          (await json("/api/band/status")).running,
          false,
          "subscribers do not open Bluetooth sessions",
        );
      } finally {
        for (const { controller, reader } of streams) {
          controller.abort();
          await reader.cancel().catch(() => {});
        }
      }
      await json("/api/not-implemented", undefined, 404);
      const response = await fetch(base);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /MedDesk/);
      const asset = html.match(/src="(\/assets\/[^" ]+\.js)"/)[1];
      assert.equal((await fetch(base + asset)).status, 200);

      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      );
      const { artifact } = await json(
        "/api/artifacts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent("Test original.png"),
          },
          body: png,
        },
        201,
      );
      assert.deepEqual(
        Buffer.from(
          await (
            await fetch(`${base}/api/artifacts/${artifact.id}`)
          ).arrayBuffer(),
        ),
        png,
      );
      draft.sources = [
        { artifactId: artifact.id, name: artifact.name, fields: ["advice"] },
      ];
      const first = (await json(`/api/consultations/${id}`, put(draft)))
        .consultation;
      assert.equal(first.revision, 1);
      assert.equal(first.medications[0].dose, "0.500 mg");
      await json(`/api/consultations/${id}`, put(draft), 409);
      const second = (
        await json(
          `/api/consultations/${id}`,
          put({ ...first, advice: "Reviewed original source." }),
        )
      ).consultation;
      assert.equal(second.revision, 2);
      await json(
        `/api/consultations/${id}`,
        put({
          ...second,
          sources: [
            { artifactId: "a".repeat(64), name: "Missing", fields: ["advice"] },
          ],
        }),
        400,
      );
      await json(
        `/api/consultations/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "{",
        },
        400,
      );
      const revisions = (await json(`/api/consultations/${id}/history`))
        .revisions;
      assert.deepEqual(
        revisions.map((r) => r.revision),
        [2, 1],
      );
      assert.equal(revisions[1].advice, "");
      await stop();
      await start();
      const reopened = (await json(`/api/consultations/${id}`)).consultation;
      assert.equal(reopened.medications[0].frequency, "প্রতিদিন");
      assert.equal(reopened.medications[0].dose, "0.500 mg");
      assert.equal(reopened.revision, 2);
      assert.equal((await json("/api/consultations")).consultations.length, 1);
      assert.equal(
        (await json(`/api/consultations/${id}/history`)).revisions.length,
        2,
      );
    } finally {
      await stop();
      assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
