import type { Reading } from "../types";

export async function saveReading(reading: Reading) {
  const response = await fetch("/api/readings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reading),
  });
  if (!response.ok)
    throw new Error("The local server did not accept the reading.");
  return (await response.json()) as { reading: Reading };
}

export async function loadReadings(limit = 120, bridgeId = "") {
  const response = await fetch(
    `/api/readings?limit=${limit}${bridgeId ? "&bridgeId=" + encodeURIComponent(bridgeId) : ""}`,
  );
  if (!response.ok) throw new Error("Could not load local history.");
  return ((await response.json()) as { readings: Reading[] }).readings;
}
