import { useEffect, useRef, useState } from "react";
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
  const [bridgeId, setBridgeId] = useState("");
  const selected = useRef(bridgeId);
  selected.current = bridgeId;
  const acceptStatus = (value: NativeBandStatus) =>
    setNative((previous) =>
      (value.bridgeId || "") !== selected.current
        ? previous
        : !previous || value.updatedAt >= previous.updatedAt
          ? value
          : previous,
    );
  useEffect(() => {
    let active = true;
    setNative(null);
    setReadings([]);
    setOnline(false);
    const query = bridgeId ? "?bridgeId=" + encodeURIComponent(bridgeId) : "";
    const refresh = async () => {
      try {
        const [items, status] = await Promise.all([
          loadReadings(120, bridgeId),
          api<NativeBandStatus>("/api/band/status" + query),
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
    const events = new EventSource("/api/events" + query);
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
        if ((item.bridgeId || "") !== bridgeId) return;
        setReadings((previous) => mergeReadings(previous, [item]));
        setOnline(true);
      } catch {
        setOnline(false);
      }
    });
    events.addEventListener("band-status", (event) => {
      if (!active) return;
      try {
        const status = JSON.parse(
          (event as MessageEvent).data,
        ) as NativeBandStatus;
        if ((status.bridgeId || "") === bridgeId) acceptStatus(status);
      } catch {
        setOnline(false);
      }
    });
    events.onerror = () => {
      if (active) setOnline(false);
    };
    events.addEventListener("auth-expired", () => {
      if (active) window.dispatchEvent(new Event("meddesk:sign-in-required"));
    });
    return () => {
      active = false;
      events.close();
    };
  }, [bridgeId]);
  const command = async (name: "start" | "stop") => {
    try {
      acceptStatus(
        await api<NativeBandStatus>(
          `/api/band/${name}${bridgeId ? "?bridgeId=" + encodeURIComponent(bridgeId) : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
        ),
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
    bridgeId,
    selectBridge: setBridgeId,
    startNative: () => command("start"),
    stopNative: () => command("stop"),
  };
}
