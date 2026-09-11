export type ReadingSource = "band" | "demo";

export interface BandReading {
  id: string;
  observedAt: string;
  receivedAt: string;
  source: ReadingSource;
  deviceName?: string;
  bridgeId?: string;
  heartRate?: number;
  steps?: number;
  distanceMeters?: number;
  calories?: number;
  batteryPercent?: number;
}

type IncomingReading = Omit<BandReading, "id" | "receivedAt">;

const numericRanges = {
  heartRate: [25, 250],
  steps: [0, 200_000],
  distanceMeters: [0, 300_000],
  calories: [0, 20_000],
  batteryPercent: [0, 100],
} as const;

export function parseReading(input: unknown): IncomingReading | null {
  if (!input || typeof input !== "object") return null;

  const body = input as Record<string, unknown>;
  if (body.source !== "band" && body.source !== "demo") return null;
  if (
    typeof body.observedAt !== "string" ||
    Number.isNaN(Date.parse(body.observedAt))
  ) {
    return null;
  }

  const reading: IncomingReading = {
    observedAt: new Date(body.observedAt).toISOString(),
    source: body.source,
  };

  if (typeof body.deviceName === "string" && body.deviceName.trim()) {
    reading.deviceName = body.deviceName.trim().slice(0, 80);
  }

  let metricCount = 0;
  for (const [name, [minimum, maximum]] of Object.entries(numericRanges)) {
    const value = body[name];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    ) {
      return null;
    }
    reading[name as keyof typeof numericRanges] = Math.round(value);
    metricCount += 1;
  }

  return metricCount > 0 ? reading : null;
}

export function finalizeReading(reading: IncomingReading): BandReading {
  return {
    ...reading,
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
  };
}
