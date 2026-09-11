import path from "node:path";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { WindowsBandReader } from "./band-reader.js";
import { BridgeQueue } from "./bridge-queue.js";

const directory = process.env.MEDDESK_BRIDGE_DIR || "";
const origin = process.env.MEDDESK_BRIDGE_ORIGIN || "";
const token = process.env.MEDDESK_BRIDGE_TOKEN;
if (
  !directory ||
  !origin ||
  !token ||
  !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)
)
  throw new Error("Install and enroll the desktop bridge before starting it.");
await mkdir(directory, { recursive: true });
const deviceId = process.env.MEDDESK_BRIDGE_ID || "";
if (!/^[a-f0-9-]{36}$/.test(deviceId))
  throw new Error("Desktop enrollment identity is invalid.");
const queue = new BridgeQueue(path.join(directory, `queue-${deviceId}.sqlite`));
const stopFile = path.join(directory, "stop");
await unlink(stopFile).catch(() => {});
let shutdown = false,
  revoked = false,
  desiredRunning = true,
  retryAt = 0;
let failures = 0,
  message = "Connecting to MedDesk.",
  lastUploadAt: string | null = null;
const reader = new WindowsBandReader(
  path.resolve(directory, "app", "read-band-vitals.ps1"),
  async (reading) => {
    queue.add(reading);
  },
  () => {},
);
async function report() {
  const value = {
    ...reader.status(),
    uploadMessage: message,
    queued: queue.count(),
    lastUploadAt,
    server: origin,
    revoked,
  };
  const file = path.join(directory, "status.json");
  await writeFile(file + ".tmp", JSON.stringify(value), "utf8");
  await rename(file + ".tmp", file);
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    shutdown = true;
  });
try {
  while (!shutdown) {
    if (
      await readFile(stopFile, "utf8").then(
        () => true,
        () => false,
      )
    )
      break;
    const started = Date.now();
    const batch = queue.batch();
    try {
      const response = await fetch(origin + "/api/bridge/uplink", {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ readings: batch, status: reader.status() }),
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 401 || response.status === 403) {
        revoked = true;
        desiredRunning = false;
        message =
          "Desktop access was revoked. Enroll this computer again to resume.";
      } else {
        if (!response.ok)
          throw new Error(`Server returned ${response.status}.`);
        const result = (await response.json()) as {
          accepted?: unknown;
          desiredRunning?: unknown;
        };
        if (
          !Array.isArray(result.accepted) ||
          result.accepted.some(
            (id) =>
              typeof id !== "string" || !batch.some((item) => item.id === id),
          ) ||
          typeof result.desiredRunning !== "boolean"
        )
          throw new Error("Invalid acknowledgment. Readings retained locally.");
        queue.acknowledge(result.accepted);
        desiredRunning = result.desiredRunning;
        failures = 0;
        lastUploadAt = new Date().toISOString();
        message = desiredRunning
          ? "Connected. Readings are delivered every 10 seconds."
          : "Monitoring paused from the dashboard.";
      }
    } catch {
      failures++;
      message =
        "Server unreachable. Readings are queued on this PC and will retain their original timestamps.";
    }
    if ((!desiredRunning || revoked) && reader.status().running)
      await reader.stop();
    if (
      desiredRunning &&
      !revoked &&
      !reader.status().running &&
      Date.now() >= retryAt &&
      queue.count() < 30_000
    ) {
      try {
        reader.start();
      } catch {
        message =
          "Bluetooth is unavailable. Check Windows pairing and the band key.";
      }
      retryAt = Date.now() + 30_000;
    }
    await report();
    if (revoked) break;
    // One network request at a time, with bounded backoff. Bluetooth has its own serial 10-second loop.
    const interval = Math.min(60_000, 10_000 * 2 ** Math.min(failures, 3));
    while (!shutdown && Date.now() - started < interval) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (
        await readFile(stopFile, "utf8").then(
          () => true,
          () => false,
        )
      ) {
        shutdown = true;
        break;
      }
    }
  }
} finally {
  await reader.stop();
  await report();
  queue.close();
}
