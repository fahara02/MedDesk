// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SpeechTool } from "./SpeechTool";
import { Assistant } from "./Assistant";
import { newConsultation } from "../lib/clinic";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("browser speech uses the current source text and ignores callbacks after editing", async () => {
  const voice = {
    name: "Synthetic English",
    voiceURI: "test-en",
    lang: "en-US",
  };
  const synthesis = Object.assign(new EventTarget(), {
    getVoices: () => [voice],
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    paused: false,
  });
  vi.stubGlobal("speechSynthesis", synthesis);
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ voices: [] }))),
  );
  const { rerender } = render(<SpeechTool text="Authored dose 0.500 mg" />);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Read aloud" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  const utterance = synthesis.speak.mock.calls[0][0];
  expect(utterance.text).toBe("Authored dose 0.500 mg");
  expect(utterance.lang).toBe("en-US");
  act(() => utterance.onstart());
  expect(screen.getByText("Reading the document")).toBeTruthy();
  rerender(<SpeechTool text="Changed authored text" />);
  act(() => utterance.onend());
  expect(screen.getByRole("status").textContent).toContain(
    "current document text",
  );
  expect(synthesis.cancel).toHaveBeenCalled();
  rerender(<SpeechTool text="প্রতিদিন" />);
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  expect(screen.getByRole("status").textContent).toContain(
    "Select a Bengali voice",
  );
  expect(synthesis.speak).toHaveBeenCalledTimes(1);
});
it("editing aborts pending Windows speech and cannot publish old audio", async () => {
  vi.stubGlobal("speechSynthesis", undefined);
  let finish: (response: Response) => void = () => {};
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/speech/voices")
        return Promise.resolve(
          new Response(
            JSON.stringify({
              voices: [{ name: "Synthetic Windows", language: "en-US" }],
            }),
          ),
        );
      signal = options?.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }),
  );
  const create = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    },
  );
  const { rerender } = render(<SpeechTool text="First document" />);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Read aloud" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  expect(signal?.aborted).toBe(false);
  rerender(<SpeechTool text="Edited document" />);
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    finish(new Response(new Blob(["RIFF synthetic test WAV"])));
  });
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Prescription audio")).toBeNull();
});
it("Qwen proposals require explicit insertion and cannot be inserted into a changed draft", async () => {
  const input = newConsultation();
  input.patient.name = "Synthetic patient";
  input.complaints = "0.500 mg প্রতিদিন";
  const onInsert = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/assistant/status")
        return new Response(
          JSON.stringify({
            configured: true,
            model: "Synthetic model",
            retrieval: { products: 1 },
          }),
        );
      expect(JSON.parse(String(options?.body)).draft.complaints).toBe(
        "0.500 mg প্রতিদিন",
      );
      return new Response(
        JSON.stringify({
          answer: "Review this proposed wording.",
          proposal: "0.500 mg প্রতিদিন",
          citations: ["document"],
          sources: [],
          documentHash: "synthetic",
          model: "Synthetic model",
        }),
      );
    }),
  );
  const { rerender } = render(
    <Assistant draft={input} navigate={() => {}} onInsert={onInsert} />,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Improve wording" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask Qwen" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Insert proposal at cursor" }),
    ).toBeTruthy(),
  );
  expect(onInsert).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Insert proposal at cursor" }),
  );
  expect(onInsert).toHaveBeenCalledWith("0.500 mg প্রতিদিন");
  rerender(
    <Assistant
      draft={{ ...input, complaints: "Different authored instructions" }}
      navigate={() => {}}
      onInsert={onInsert}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Insert proposal at cursor" }),
  ).toBeNull();
  expect(screen.getByText(/document changed after this answer/i)).toBeTruthy();
});

it("canceling Qwen suppresses a late response", async () => {
  let finish: (response: Response) => void = () => {};
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/assistant/status")
        return Promise.resolve(
          new Response(
            JSON.stringify({
              configured: true,
              model: "Synthetic",
              retrieval: { products: 0 },
            }),
          ),
        );
      signal = options?.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }),
  );
  render(
    <Assistant
      draft={newConsultation()}
      navigate={() => {}}
      onInsert={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Review this draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask Qwen" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    finish(
      new Response(
        JSON.stringify({
          answer: "Canceled answer",
          proposal: "Late proposal",
          citations: [],
          sources: [],
          model: "Synthetic",
        }),
      ),
    );
  });
  expect(screen.queryByText("Canceled answer")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Insert proposal at cursor" }),
  ).toBeNull();
});
