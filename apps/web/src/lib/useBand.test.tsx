// @vitest-environment jsdom
import {
  act,
  cleanup,
  renderHook,
  waitFor,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBand } from "./useBand";
import { newConsultation } from "./clinic";
import { VitalsWorkspace } from "../components/WorkspacePages";
import type { NativeBandStatus } from "../../../server/src/band-reader";
import type { Reading } from "../types";

class Stream extends EventTarget {
  static latest: Stream;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) {
    super();
    Stream.latest = this;
  }
  emit(event: string, value: unknown) {
    this.dispatchEvent(
      new MessageEvent(event, { data: JSON.stringify(value) }),
    );
  }
}
let saved: Reading[];
let status: NativeBandStatus;
beforeEach(() => {
  saved = [];
  const now = new Date().toISOString();
  status = {
    available: true,
    running: true,
    phase: "measuring",
    message: "Receiving",
    readings: 0,
    pollIntervalMs: 10000,
    updatedAt: now,
    startedAt: now,
  };
  vi.stubGlobal("EventSource", Stream);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.startsWith("/api/readings")
              ? { readings: saved }
              : url === "/api/sleep"
                ? { status: "empty", sessions: [], sourceDays: 0 }
                : status,
          ),
        ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("subscribes once, preserves observation times, catches up after reconnect, and closes the stream", async () => {
  const { result, unmount } = renderHook(() => useBand());
  await waitFor(() => expect(result.current.native?.running).toBe(true));
  expect(result.current.online).toBe(false);
  expect(Stream.latest.url).toBe("/api/events");
  const first: Reading = {
    id: "first",
    source: "band",
    heartRate: 81,
    observedAt: new Date(Date.now() - 10000).toISOString(),
  };
  act(() => {
    Stream.latest.emit("ready", {});
    Stream.latest.emit("reading", first);
  });
  await waitFor(() => expect(result.current.readings).toEqual([first]));
  expect(result.current.online).toBe(true);
  act(() => Stream.latest.onerror?.());
  expect(result.current.online).toBe(false);
  const second: Reading = {
    ...first,
    id: "second",
    heartRate: 82,
    observedAt: new Date().toISOString(),
  };
  saved = [first, second];
  act(() => {
    Stream.latest.emit("ready", {});
    Stream.latest.emit("reading", second);
  });
  await waitFor(() => expect(result.current.readings).toEqual([first, second]));
  expect(result.current.online).toBe(true);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(
        ([, options]) => !options?.method || options.method === "GET",
      ),
  ).toBe(true);
  const requests = vi.mocked(fetch).mock.calls.length;
  vi.useFakeTimers();
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);
  unmount();
  expect(Stream.latest.close).toHaveBeenCalledOnce();
});

it("routes controls only to the server and rejects an older status snapshot", async () => {
  const { result } = renderHook(() => useBand());
  await waitFor(() => expect(result.current.native?.running).toBe(true));
  const stopped = {
    ...status,
    running: false,
    phase: "stopped",
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  };
  act(() => Stream.latest.emit("band-status", stopped));
  await act(() => result.current.startNative());
  expect(fetch).toHaveBeenCalledWith(
    "/api/band/start",
    expect.objectContaining({ method: "POST", body: "{}" }),
  );
  expect(result.current.native?.phase).toBe("stopped");
  await act(() => result.current.stopNative());
  expect(fetch).toHaveBeenCalledWith(
    "/api/band/stop",
    expect.objectContaining({ method: "POST" }),
  );
});

it("renders streamed readings, marks them stale after 25 seconds, and never invents sleep", async () => {
  function Monitor() {
    return (
      <VitalsWorkspace
        band={useBand()}
        draft={newConsultation()}
        onAttach={() => {}}
      />
    );
  }
  vi.useFakeTimers();
  await act(async () => {
    render(<Monitor />);
  });
  expect(
    screen.getByRole("button", { name: "Stop live monitoring" }),
  ).toBeTruthy();
  const pulse: Reading = {
    id: "pulse",
    source: "band",
    heartRate: 83,
    observedAt: new Date().toISOString(),
  };
  await act(async () => {
    Stream.latest.emit("ready", {});
    Stream.latest.emit("reading", pulse);
  });
  expect(screen.getByText("LIVE · receiving heart rate")).toBeTruthy();
  expect(
    screen.getByText(/No sleep records were returned by Zepp/),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Band authentication key")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(26000));
  expect(screen.queryByText("LIVE · receiving heart rate")).toBeNull();
  expect(
    screen.getByText("Waiting for a fresh heart-rate sample"),
  ).toBeTruthy();
  await act(async () => Stream.latest.onerror?.());
  expect(screen.getByText("Service offline · saved data")).toBeTruthy();
});
