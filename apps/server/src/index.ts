import express, { type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeReading, parseReading, type BandReading } from "./reading.js";
import { ReadingStore } from "./store.js";

const port = Number(process.env.PORT) || 8787;
const app = express();
const store = new ReadingStore();
const eventClients = new Set<Response>();

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "meddesk-mi-band", now: new Date().toISOString() });
});

app.get("/api/readings", (request, response) => {
  const requested = Number(request.query.limit);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.round(requested), 1), 500) : 120;
  response.json({ readings: store.latest(limit) });
});

app.get("/api/events", (request, response) => {
  response.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });
  response.flushHeaders();
  response.write("event: ready\ndata: {}\n\n");
  eventClients.add(response);
  request.on("close", () => eventClients.delete(response));
});

app.post("/api/readings", async (request, response, next) => {
  try {
    const parsed = parseReading(request.body);
    if (!parsed) {
      response.status(400).json({ error: "A valid timestamp, source, and at least one metric are required." });
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

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
app.use(express.static(webDist));
app.get("/{*path}", (_request, response) => response.sendFile(path.join(webDist, "index.html")));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: "The local server could not process this request." });
});

function publish(reading: BandReading) {
  const message = `event: reading\ndata: ${JSON.stringify(reading)}\n\n`;
  for (const client of eventClients) client.write(message);
}

const keepAlive = setInterval(() => {
  for (const client of eventClients) client.write(": keep-alive\n\n");
}, 20_000);
keepAlive.unref();

await store.initialize();
app.listen(port, () => {
  console.log(`MedDesk Mi Band server listening on http://localhost:${port}`);
});
