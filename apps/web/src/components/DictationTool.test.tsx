// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DictationTool } from "./DictationTool";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => Response.json({ available: false }))));

it("unlocks capture after a speech service error even when the browser never emits end", () => {
  let recognition: any;
  vi.stubGlobal("SpeechRecognition", class {
    onstart: any; onerror: any;
    constructor() { recognition = this; }
    start() { this.onstart(); } abort() {}
  });
  render(<DictationTool onInsert={vi.fn()} />);
  fireEvent.click(screen.getByText("Start dictation"));
  act(() => recognition.onerror({ error: "network" }));
  expect((screen.getByText("Start dictation") as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("status").textContent).toMatch(/speech service could not connect/);
});

it("allows cancellation while permission is pending and releases a late microphone", async () => {
  let grant: any;
  const stop = vi.fn();
  vi.stubGlobal("MediaRecorder", class { static isTypeSupported() { return true; } });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } });
  render(<DictationTool onInsert={vi.fn()} />);
  fireEvent.click(screen.getByText("Record audio sample"));
  fireEvent.click(screen.getByText("Cancel microphone request"));
  await act(async () => grant({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalledOnce();
  expect((screen.getByText("Record audio sample") as HTMLButtonElement).disabled).toBe(false);
});

it("retains exact finalized dictation once, requires insertion, and ignores callbacks after unmount", () => {
  let recognition: any;
  vi.stubGlobal("SpeechRecognition", class {
    lang = ""; continuous = false; interimResults = false;
    onstart: any; onresult: any; onend: any;
    start = vi.fn(() => this.onstart()); stop = vi.fn(() => this.onend()); abort = vi.fn();
    constructor() { recognition = this; }
  });
  const insert = vi.fn();
  const { unmount } = render(<DictationTool onInsert={insert} />);
  expect((screen.getByLabelText("Spoken language") as HTMLSelectElement).value).toBe("en-US");
  fireEvent.change(screen.getByLabelText("Spoken language"), { target: { value: "bn-BD" } });
  fireEvent.click(screen.getByText("Start dictation"));
  expect(recognition.lang).toBe("bn-BD");
  const first = { isFinal: true, 0: { transcript: "0.500 mg প্রতিদিন" } };
  act(() => recognition.onresult({ resultIndex: 0, results: [first, { isFinal: false, 0: { transcript: "রাতে" } }] }));
  act(() => recognition.onresult({ resultIndex: 1, results: [first, { isFinal: true, 0: { transcript: "রাতে" } }] }));
  expect((screen.getByLabelText("Recognized text") as HTMLTextAreaElement).value).toBe("0.500 mg প্রতিদিন রাতে");
  expect(insert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Stop dictation"));
  fireEvent.click(screen.getByText("Insert text at cursor"));
  expect(insert).toHaveBeenCalledExactlyOnceWith("0.500 mg প্রতিদিন রাতে");
  fireEvent.click(screen.getByText("Start dictation"));
  unmount();
  expect(recognition.abort).toHaveBeenCalledOnce();
  act(() => recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "late" } }] }));
  expect(insert).toHaveBeenCalledTimes(1);
});

it("releases a microphone granted after the recording panel closes", async () => {
  let grant: any;
  const stop = vi.fn();
  vi.stubGlobal("MediaRecorder", class { static isTypeSupported() { return true; } });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) } });
  const { unmount } = render(<DictationTool onInsert={vi.fn()} />);
  fireEvent.click(screen.getByText("Record audio sample"));
  unmount();
  await act(async () => grant({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalledOnce();
});

it("records locally and uploads only after an explicit send", async () => {
  let recording: any;
  const stop = vi.fn(), fetch = vi.fn(async (_url: string) => new Response(JSON.stringify({ sample: { id: "sample-test" } }), { status: 201 }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } });
  vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:test"; } static revokeObjectURL() {} });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported() { return true; }
    state = "inactive"; mimeType = "audio/webm"; ondataavailable: any; onstop: any;
    constructor() { recording = this; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: this.mimeType }) }); this.onstop(); }
  });
  render(<DictationTool onInsert={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByText("Record audio sample")));
  expect(recording.state).toBe("recording");
  fireEvent.click(screen.getByText("Stop recording"));
  expect(stop).toHaveBeenCalledOnce(); expect(fetch.mock.calls.filter(call => call[0] === "/api/audio-samples")).toHaveLength(0);
  await act(async () => fireEvent.click(screen.getByText("Send sample for comparison")));
  expect(fetch.mock.calls.filter(call => call[0] === "/api/audio-samples")).toHaveLength(1);
  expect(fetch).toHaveBeenCalledWith("/api/audio-samples", expect.objectContaining({ headers: expect.objectContaining({ "X-Audio-Language": "en-US" }) }));
  expect(screen.getByText(/Sample received: sample-test/)).toBeTruthy();
});

it("records through the selected microphone and transcribes without browser speech recognition", async () => {
  let recording: any;
  const capture = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: capture, enumerateDevices: async () => [{ kind: "audioinput", deviceId: "usb-mic", label: "USB microphone" }] } });
  vi.stubGlobal("SpeechRecognition", class { constructor() { throw new Error("Browser recognition must not run"); } });
  vi.stubGlobal("URL", class extends URL { static createObjectURL() { return "blob:dictation"; } static revokeObjectURL() {} });
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported() { return true; }
    state = "inactive"; mimeType = "audio/webm"; ondataavailable: any; onstop: any;
    constructor() { recording = this; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable({ data: new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3])], { type: this.mimeType }) }); this.onstop(); }
  });
  const fetch = vi.fn(async (url: string) => Response.json(url === "/api/transcription/status" ? { available: true } : { text: "0.500 mg exactly" }));
  vi.stubGlobal("fetch", fetch);
  const insert = vi.fn(); render(<DictationTool onInsert={insert} />);
  await screen.findByText(/Start dictation records your voice/);
  fireEvent.change(screen.getByLabelText("Microphone"), { target: { value: "usb-mic" } });
  await act(async () => fireEvent.click(screen.getByText("Start dictation")));
  expect(capture).toHaveBeenCalledWith({ audio: { deviceId: { exact: "usb-mic" } } });
  expect(recording.state).toBe("recording");
  await act(async () => fireEvent.click(screen.getByText("Stop dictation")));
  expect((screen.getByLabelText("Recognized text") as HTMLTextAreaElement).value).toBe("0.500 mg exactly");
  expect(insert).not.toHaveBeenCalled();
  expect(fetch.mock.calls.some(call => call[0] === "/api/audio-samples")).toBe(false);
  fireEvent.click(screen.getByText("Insert text at cursor"));
  expect(insert).toHaveBeenCalledExactlyOnceWith("0.500 mg exactly");
});
