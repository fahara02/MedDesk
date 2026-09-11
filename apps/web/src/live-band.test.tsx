// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBand } from "./lib/useBand";
import { newConsultation } from "./lib/clinic";
import { VitalsWorkspace } from "./components/WorkspacePages";
import type { Reading } from "./types";

const base = process.env.MEDDESK_LIVE_URL;
const nativeFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Opt-in, read-only check against a running, physically connected Windows server.
// Uses a fetch-stream adapter because Node and jsdom have different Event classes.
// It does not generate or post readings.
it.skipIf(!base)(
  "renders physical band SSE readings in React at the server polling cadence",
  { timeout: 55000 },
  async () => {
    expect(new URL(base!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    const activity: number[] = [],
      pulses: Reading[] = [];
    let closed = false;
    vi.stubGlobal("fetch", (url: string, options?: RequestInit) => {
      expect(options?.method ?? "GET").toBe("GET");
      return nativeFetch(new URL(url, base), options);
    });
    vi.stubGlobal(
      "EventSource",
      class extends EventTarget {
        private controller = new AbortController();
        onerror: (() => void) | null = null;
        constructor(url: string) {
          super();
          this.addEventListener("reading", (event) => {
            const reading: Reading = JSON.parse((event as MessageEvent).data);
            expect(reading.source).toBe("band");
            if (reading.steps !== undefined) activity.push(Date.now());
            if (reading.heartRate !== undefined) pulses.push(reading);
          });
          void this.consume(url);
        }
        private async consume(url: string) {
          try {
            const response = await nativeFetch(new URL(url, base), {
              signal: this.controller.signal,
            });
            if (!response.ok) throw new Error(`SSE HTTP ${response.status}`);
            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let buffered = "";
            try {
              while (!this.controller.signal.aborted) {
                const { value, done } = await reader.read();
                if (done) break;
                buffered += decoder.decode(value, { stream: true });
                let boundary;
                while ((boundary = buffered.indexOf("\n\n")) !== -1) {
                  const frame = buffered.slice(0, boundary);
                  buffered = buffered.slice(boundary + 2);
                  const name = frame
                    .split("\n")
                    .find((line) => line.startsWith("event: "))
                    ?.slice(7);
                  const data = frame
                    .split("\n")
                    .filter((line) => line.startsWith("data: "))
                    .map((line) => line.slice(6))
                    .join("\n");
                  if (name)
                    this.dispatchEvent(new MessageEvent(name, { data }));
                }
              }
            } finally {
              await reader.cancel().catch(() => {});
            }
          } catch {
            if (!this.controller.signal.aborted) this.onerror?.();
          }
        }
        close() {
          closed = true;
          this.controller.abort();
        }
      },
    );
    function Monitor() {
      return (
        <VitalsWorkspace
          band={useBand()}
          draft={newConsultation()}
          onAttach={() => {}}
        />
      );
    }
    await act(async () => {
      render(<Monitor />);
    });
    await waitFor(
      () => {
        expect(activity.length).toBeGreaterThanOrEqual(3);
        expect(pulses.length).toBeGreaterThanOrEqual(3);
        expect(screen.getByText("LIVE · receiving heart rate")).toBeTruthy();
      },
      { timeout: 45000, interval: 100 },
    );
    const intervals = activity.slice(1).map((time, i) => time - activity[i]);
    for (const interval of intervals) {
      expect(interval).toBeGreaterThan(8000);
      expect(interval).toBeLessThan(14000);
    }
    expect(new Set(pulses.map((reading) => reading.id)).size).toBe(
      pulses.length,
    );
    expect(Date.now() - Date.parse(pulses.at(-1)!.observedAt)).toBeLessThan(
      20000,
    );
    expect(
      screen.getByText("Event stream connected · 10-second polling"),
    ).toBeTruthy();
    console.info(
      JSON.stringify({
        physicalHeartRateEvents: pulses.length,
        activityIntervalsMs: intervals,
        reactLive: true,
      }),
    );
    cleanup();
    expect(closed).toBe(true);
  },
);
