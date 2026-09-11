import { useEffect, useState } from "react";
import { loadReadings } from "./api";
import { api } from "./clinic";
import type { Reading } from "../types";
import type { NativeBandStatus } from "../../../server/src/band-reader";

function mergeReadings(existing: Reading[], incoming: Reading[]) {
  const byId = new Map(existing.map((reading) => [reading.id, reading]));
  for (const reading of incoming) byId.set(reading.id, reading);
  return [...byId.values()]
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
    .slice(-120);
}

export function useBand() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [online, setOnline] = useState(false);
  const [native, setNative] = useState<NativeBandStatus | null>(null);
  const acceptStatus = (value: NativeBandStatus) =>
    setNative((previous) =>
      !previous || value.updatedAt >= previous.updatedAt ? value : previous,
    );
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [items, status] = await Promise.all([
          loadReadings(),
          api<NativeBandStatus>("/api/band/status"),
        ]);
        if (active) {
          setReadings((previous) => mergeReadings(previous, items));
          acceptStatus(status);
        }
      } catch {
        if (active) setOnline(false);
      }
    };
    void refresh();
    const events = new EventSource("/api/events");
    events.addEventListener("ready", () => {
      if (active) {
        setOnline(true);
        void refresh();
      }
    });
    events.addEventListener("reading", (event) => {
      if (!active) return;
      try {
        const item = JSON.parse((event as MessageEvent).data) as Reading;
        setReadings((previous) => mergeReadings(previous, [item]));
        setOnline(true);
      } catch {
        setOnline(false);
      }
    });
    events.addEventListener("band-status", (event) => {
      if (!active) return;
      try {
        acceptStatus(JSON.parse((event as MessageEvent).data));
      } catch {
        setOnline(false);
      }
    });
    events.onerror = () => {
      if (active) setOnline(false);
    };
    return () => {
      active = false;
      events.close();
    };
  }, []);
  const command = async (name: "start" | "stop") => {
    try {
      acceptStatus(
        await api<NativeBandStatus>(`/api/band/${name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
    } catch (error) {
      setNative((previous) =>
        previous
          ? { ...previous, message: (error as Error).message }
          : previous,
      );
    }
  };
  return {
    readings,
    online,
    native,
    startNative: () => command("start"),
    stopNative: () => command("stop"),
  };
}
