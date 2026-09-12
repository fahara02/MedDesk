import express, { type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeReading, parseReading, type BandReading } from "./reading.js";
import { ReadingStore } from "./store.js";
import { ConsultationStore, ClinicError } from "./consultations.js";
import { parseConsultation } from "./clinical-model.js";
import { MedicineCatalog } from "./catalog.js";
import { ArtifactStore } from "./artifacts.js";
import { WindowsBandReader } from "./band-reader.js";
import { SleepStore } from "./sleep.js";
import { DrugIndex } from "./drug-index.js";
import { PrescriptionAssistant } from "./assistant.js";
import { SpeechService } from "./speech.js";
import { AudioSamples } from "./audio-samples.js";
import { TranscriptionService } from "./transcription.js";
import { BridgeRegistry } from "./bridge-registry.js";
import { remoteAccess } from "./remote-access.js";
import { WorkspaceAuth } from "./auth.js";
import { mkdir } from "node:fs/promises";

const port = Number(process.env.PORT) || 8787;
const app = express();
const auth = new WorkspaceAuth(process.env.MEDDESK_PUBLIC_ORIGIN,
  process.env.MEDDESK_LOGIN_USER, process.env.MEDDESK_PASSWORD_HASH);
const dataDirectory = path.resolve(
  process.env.MEDDESK_DATA_DIR ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data"),
);
const store = new ReadingStore(path.join(dataDirectory, "readings.jsonl"));
const clinic = new ConsultationStore(
  path.join(dataDirectory, "clinic", "consultations"),
);
const catalog = new MedicineCatalog(dataDirectory);
const drugIndex = new DrugIndex(path.join(dataDirectory, "medicines.sqlite"));
const assistant = new PrescriptionAssistant(
  process.env.MEDDESK_LUNA_ENV || "E:/Projects/LabaidAi-LUNA/.env",
  drugIndex,
);
const speech = new SpeechService(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../synthesize-speech.ps1",
  ),
);
const artifacts = new ArtifactStore(
  path.join(dataDirectory, "clinic", "artifacts"),
);
const audioSamples = new AudioSamples(path.join(dataDirectory, "voice-samples"));
const transcription = new TranscriptionService();
const eventClients = new Set<Response>();
await mkdir(dataDirectory, { recursive: true });
const bridges = new BridgeRegistry(path.join(dataDirectory, "bridges.sqlite"));
const bandStatus = (id: unknown) =>
  typeof id === "string" && id ? bridges.status(id) : bandReader.status();
const sleep = new SleepStore(
  path.join(dataDirectory, "health"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
);
const bandReader = new WindowsBandReader(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../read-band-vitals.ps1",
  ),
  async (incoming) => {
    const reading = finalizeReading(incoming);
    await store.add(reading);
    publish(reading);
  },
  (status) =>
    broadcast(`event: band-status\ndata: ${JSON.stringify(status)}\n\n`),
);

app.disable("x-powered-by");
app.use(
  remoteAccess(
    process.env.MEDDESK_PUBLIC_ORIGIN,
    process.env.MEDDESK_PROXY_SECRET,
  ),
);
app.use(express.json({ limit: "1mb" }));
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use(auth.middleware);

app.get("/api/capabilities", (_request, response) =>
  response.json({
    consultation: true,
    artifacts: true,
    medicineCatalog: catalog.status(),
    nativeLps: false,
    ocr: false,
    assistant: assistant.status().configured,
    assistantDetails: assistant.status(),
    neuralSpeech: false,
    speech: speech.status().available,
    signatures: false,
    pharmacyEvents: false,
    mode: process.env.MEDDESK_PUBLIC_ORIGIN
      ? "remote-workspace"
      : "local-workspace",
    desktopBridge: true,
    windowsBandRead: bandReader.status().available,
  }),
);
app.get("/api/assistant/status", (_request, response) =>
  response.json(assistant.status()),
);
app.get("/api/speech/voices", (_request, response) =>
  response.json(speech.status()),
);
app.get("/api/prescriber/signature", (_request, response) => {
  response.sendFile(path.join(dataDirectory, "prescriber", "signature.jpg"), error => {
    if (error && !response.headersSent) response.status(404).json({ error: "No saved signature is available." });
  });
});
app.get("/api/audio-samples", async (_request, response) => response.json({ samples: await audioSamples.list() }));
app.get("/api/transcription/status", (_request, response) => response.json(transcription.status()));
app.post("/api/transcription", express.raw({ type: "audio/*", limit: "8mb" }), async (request, response) => {
  const controller = new AbortController();
  response.once("close", () => { if (!response.writableEnded) controller.abort(); });
  response.json(await transcription.transcribe(request.body, request.get("Content-Type") || "", request.get("X-Audio-Language"), controller.signal));
});
app.post("/api/audio-samples", express.raw({ type: "audio/*", limit: "8mb" }), async (request, response) => {
  response.status(201).json({ sample: await audioSamples.save(request.body, request.get("Content-Type") || "", request.get("X-Audio-Language")) });
});
app.post("/api/speech", async (request, response) => {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  const result = await speech.synthesize(request.body, controller.signal);
  response
    .set({
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
      "X-Text-SHA256": result.hash,
    })
    .send(result.audio);
});
app.get("/api/medicines/retrieve", (request, response) =>
  response.json({
    sources: drugIndex.search(String(request.query.q || "").slice(0, 2000)),
    index: drugIndex.status(),
  }),
);
app.post("/api/assistant/ask", async (request, response) => {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  response.json(await assistant.ask(request.body, controller.signal));
});
app.get("/api/band/status", (request, response) =>
  response.json(bandStatus(request.query.bridgeId)),
);
app.post("/api/band/start", (request, response) =>
  response
    .status(202)
    .json(
      typeof request.query.bridgeId === "string" && request.query.bridgeId
        ? bridges.command(request.query.bridgeId, true)
        : bandReader.start(),
    ),
);
app.post("/api/band/stop", async (request, response) =>
  response.json(
    typeof request.query.bridgeId === "string" && request.query.bridgeId
      ? bridges.command(request.query.bridgeId, false)
      : await bandReader.stop(),
  ),
);
app.get("/api/bridge/devices", (_request, response) =>
  response.json({ devices: bridges.devices() }),
);
app.get("/downloads/MedDesk-Bridge-Setup.exe", (_request, response) => {
  response.download(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../releases/MedDesk-Bridge-Setup.exe",
    ),
    "MedDesk-Bridge-Setup.exe",
    (error) => {
      if (error && !response.headersSent)
        response
          .status(404)
          .json({
            error:
              "The desktop installer has not been packaged on this server yet.",
          });
    },
  );
});
app.post("/api/bridge/invites", (request, response) =>
  response.status(201).json(bridges.invite(request.body?.label)),
);
app.post("/api/bridge/enroll", (request, response) =>
  response.status(201).json(bridges.enroll(request.body?.code)),
);
app.delete("/api/bridge/devices/:id", (request, response) => {
  bridges.revoke(request.params.id);
  response.json({ revoked: true });
});
app.post("/api/bridge/uplink", (request, response) => {
  const id = bridges.authenticate(request.get("Authorization"));
  const result = bridges.receive(id, request.body);
  for (const reading of bridges.pending()) {
    publish(reading);
    bridges.published(reading.id);
  }
  broadcast(
    `event: band-status\ndata: ${JSON.stringify(bridges.status(id))}\n\n`,
  );
  response.json(result);
});
app.get("/api/sleep", async (_request, response) =>
  response.json(await sleep.get()),
);
app.post("/api/sleep/sync", async (_request, response) =>
  response.json(await sleep.sync()),
);
app.get("/api/consultations", async (_request, response) =>
  response.json({ consultations: await clinic.list() }),
);
app.get("/api/consultations/:id/history", async (request, response) =>
  response.json({ revisions: await clinic.history(request.params.id) }),
);
app.get("/api/consultations/:id", async (request, response) => {
  const consultation = await clinic.get(request.params.id);
  if (!consultation)
    return response.status(404).json({ error: "Consultation not found." });
  response.json({ consultation });
});
app.put("/api/consultations/:id", async (request, response) => {
  const input = parseConsultation(request.body);
  if (!input || input.id !== request.params.id)
    return response
      .status(400)
      .json({ error: "Check the patient name, date and consultation fields." });
  for (const source of input.sources)
    if (!(await artifacts.get(source.artifactId)))
      throw new ClinicError(
        "A referenced source file is missing. Import it again.",
        400,
      );
  response.json({
    consultation: await clinic.save(
      input,
      (id) => store.get(id) || bridges.get(id),
    ),
  });
});
app.get("/api/medicines/search", (request, response) =>
  response.json({
    medicines: catalog.search(String(request.query.q ?? "").slice(0, 200)),
  }),
);
app.get("/api/medicines/:id", (request, response) => {
  const medicine = catalog.get(request.params.id);
  if (!medicine)
    return response.status(404).json({ error: "Medicine not found." });
  response.json({ medicine });
});
app.post(
  "/api/artifacts",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
  async (request, response) => {
    let name = "Source document";
    try {
      name = decodeURIComponent(String(request.headers["x-file-name"] ?? name));
    } catch {}
    response
      .status(201)
      .json({ artifact: await artifacts.put(request.body, name) });
  },
);
app.get("/api/artifacts/:id", async (request, response) => {
  const artifact = await artifacts.get(request.params.id);
  if (!artifact)
    return response.status(404).json({ error: "Source file not found." });
  response.type(artifact.mime).sendFile(artifact.file);
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "meddesk-clinical-workspace",
    now: new Date().toISOString(),
  });
});

app.get("/api/readings", (request, response) => {
  const requested = Number(request.query.limit);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.round(requested), 1), 500)
    : 120;
  response.json({
    readings:
      typeof request.query.bridgeId === "string" && request.query.bridgeId
        ? bridges.latest(request.query.bridgeId, limit)
        : store.latest(limit),
  });
});

app.get("/api/events", (request, response) => {
  const status = bandStatus(request.query.bridgeId);
  response.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  response.write("retry: 3000\nevent: ready\ndata: {}\n\n");
  response.write(`event: band-status\ndata: ${JSON.stringify(status)}\n\n`);
  eventClients.add(response);
  auth.watchStream(request, response);
  response.on("close", () => eventClients.delete(response));
});

app.post("/api/readings", async (request, response, next) => {
  try {
    const parsed = parseReading(request.body);
    if (!parsed) {
      response.status(400).json({
        error:
          "A valid timestamp, source, and at least one metric are required.",
      });
      return;
    }

    const reading = finalizeReading(parsed);
    await store.add(reading);
    publish(reading);
    response.status(201).json({ reading });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (_request, response) =>
  response.status(404).json({ error: "This operation is not available." }),
);
const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);
app.use(express.static(webDist));
app.get("/{*path}", (_request, response) =>
  response.sendFile(path.join(webDist, "index.html")),
);

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    const status =
      error instanceof ClinicError
        ? error.status
        : [400, 413].includes((error as { status?: number })?.status ?? 0)
          ? (error as { status: number }).status
          : 500;
    response.status(status).json({
      error:
        error instanceof ClinicError
          ? error.message
          : status === 400
            ? "The request contains invalid JSON. Your draft is unchanged."
            : status === 413
              ? "This file or request is too large."
              : "The local server could not process this request. Your draft is unchanged.",
    });
  },
);

function publish(reading: BandReading) {
  const message = `event: reading\ndata: ${JSON.stringify(reading)}\n\n`;
  broadcast(message);
}

function broadcast(message: string) {
  for (const client of eventClients) {
    if (client.destroyed || !client.write(message)) {
      eventClients.delete(client);
      client.destroy();
    }
  }
}

const keepAlive = setInterval(() => {
  broadcast(": keep-alive\n\n");
  for (const device of bridges.devices())
    broadcast(`event: band-status\ndata: ${JSON.stringify(device.status)}\n\n`);
}, 20_000);
keepAlive.unref();

await store.initialize();
await Promise.all([
  clinic.initialize(),
  artifacts.initialize(),
  catalog.initialize(),
]);
drugIndex.initialize(catalog);
await assistant.initialize();
await speech.initialize();
const server = app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(
    `MedDesk clinical workspace listening on http://localhost:${port}`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void bandReader.stop().finally(() => {
      server.close();
      auth.close();
      for (const client of eventClients) client.end();
      process.exit(0);
    });
  });
