// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DictationTool } from "./DictationTool";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
  const stop = vi.fn(), fetch = vi.fn(async () => new Response(JSON.stringify({ sample: { id: "sample-test" } }), { status: 201 }));
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
  expect(stop).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByText("Send sample for comparison")));
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith("/api/audio-samples", expect.objectContaining({ headers: expect.objectContaining({ "X-Audio-Language": "bn-BD" }) }));
  expect(screen.getByText(/Sample received: sample-test/)).toBeTruthy();
});
