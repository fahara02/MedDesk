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

const port = Number(process.env.PORT) || 8787;
const app = express();
const dataDirectory = path.resolve(
  process.env.MEDDESK_DATA_DIR ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data"),
);
const store = new ReadingStore(path.join(dataDirectory, "readings.jsonl"));
const clinic = new ConsultationStore(
  path.join(dataDirectory, "clinic", "consultations"),
);
const catalog = new MedicineCatalog(dataDirectory);
const artifacts = new ArtifactStore(
  path.join(dataDirectory, "clinic", "artifacts"),
);
const eventClients = new Set<Response>();
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
app.use(express.json({ limit: "256kb" }));
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.get("/api/capabilities", (_request, response) =>
  response.json({
    consultation: true,
    artifacts: true,
    medicineCatalog: catalog.status(),
    nativeLps: false,
    ocr: false,
    assistant: false,
    neuralSpeech: false,
    signatures: false,
    pharmacyEvents: false,
    mode: "local-workspace",
    windowsBandRead: bandReader.status().available,
  }),
);
app.get("/api/band/status", (_request, response) =>
  response.json(bandReader.status()),
);
app.post("/api/band/start", (_request, response) =>
  response.status(202).json(bandReader.start()),
);
app.post("/api/band/stop", async (_request, response) =>
  response.json(await bandReader.stop()),
);
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
    consultation: await clinic.save(input, (id) => store.get(id)),
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
  response.json({ readings: store.latest(limit) });
});

app.get("/api/events", (_request, response) => {
  response.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  response.write("retry: 3000\nevent: ready\ndata: {}\n\n");
  response.write(
    `event: band-status\ndata: ${JSON.stringify(bandReader.status())}\n\n`,
  );
  eventClients.add(response);
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
}, 20_000);
keepAlive.unref();

await store.initialize();
await Promise.all([
  clinic.initialize(),
  artifacts.initialize(),
  catalog.initialize(),
]);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(
    `MedDesk clinical workspace listening on http://localhost:${port}`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void bandReader.stop().finally(() => {
      server.close();
      for (const client of eventClients) client.end();
      process.exit(0);
    });
  });
