import type { Reading } from "../types";

export interface DisplayReading extends Reading {
  heartRateObservedAt?: string;
}

// Each packet timestamps only the metrics it actually contains.
export function mergeReading(previous: DisplayReading | null, reading: Reading): DisplayReading {
  const sameDevice = previous?.source === reading.source && previous?.deviceName === reading.deviceName;
  const result: DisplayReading = { ...(sameDevice ? previous : null), ...reading };
  for (const metric of ["heartRate", "steps", "distanceMeters", "calories", "batteryPercent"] as const) {
    if (reading[metric] === undefined && sameDevice) result[metric] = previous?.[metric];
  }
  if (reading.heartRate !== undefined) result.heartRateObservedAt = reading.observedAt;
  return result;
}
