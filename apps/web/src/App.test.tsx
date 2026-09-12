// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import App from "./App";
import { importDraft, newConsultation, blankMedication } from "./lib/clinic";
import coverage from "./content/coverage.json";

let records: Record<string, any>;
it("loads the doctor's saved signature into the footer and exposes the website installer", async () => {
  const previous = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => url === "/api/prescriber/signature"
    ? Promise.resolve(new Response(new Uint8Array([255,216,255,224]), { headers: { "Content-Type": "image/jpeg" } }))
    : previous(url, options)));
  const { container } = render(<App />);
  await waitFor(() => expect(container.querySelector('.prescription-footer [data-signature]')).not.toBeNull());
  expect(container.querySelector('.prescription-rx [data-signature]')).toBeNull();
  fireEvent.click(screen.getByText("Install Mi Band runner"));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("link", { name: "Download Windows installer" }).getAttribute("href")).toBe("/downloads/MedDesk-Bridge-Setup.exe");
  expect(within(dialog).getByLabelText("Server address")).toBeTruthy();
});

it("reopens installer setup with its still-valid computer name and enrollment code", async () => {
  const code = "0123456789abcdef0123456789abcdef";
  sessionStorage.setItem("meddesk.bridge.setup", JSON.stringify({ label: "Test consulting room", invite: { code, expiresAt: new Date(Date.now() + 60000).toISOString() } }));
  window.location.hash = "#install-band";
  render(<App />);
  const dialog = await screen.findByRole("dialog");
  expect((within(dialog).getByLabelText("Computer name") as HTMLInputElement).value).toBe("Test consulting room");
  expect(within(dialog).getByText(code)).toBeTruthy();
  sessionStorage.removeItem("meddesk.bridge.setup"); window.location.hash = "";
});
beforeEach(() => {
  records = {};
  localStorage.clear();
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
    }),
  });
  vi.stubGlobal(
    "EventSource",
    class extends EventTarget {
      close() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      let data: unknown = {};
      if (url.startsWith("/api/readings")) data = { readings: [] };
      else if (url === "/api/band/status")
        data = {
          available: true,
          running: false,
          phase: "idle",
          message: "Ready",
          readings: 0,
          updatedAt: new Date().toISOString(),
          pollIntervalMs: 10000,
        };
      else if (url === "/api/sleep")
        data = { status: "not-synced", sessions: [], sourceDays: 0 };
      else if (url === "/api/capabilities")
        data = {
          consultation: true,
          artifacts: true,
          medicineCatalog: { count: 0, files: 0, issues: [] },
        };
      else if (url === "/api/consultations")
        data = {
          consultations: Object.values(records).map((r) => ({
            ...r,
            medicationCount: r.medications.length,
          })),
        };
      else if (url.startsWith("/api/consultations/")) {
        const id = url.split("/").at(-1)!;
        if (options?.method === "PUT") {
          const body = JSON.parse(String(options.body));
          records[id] = {
            ...body,
            revision: body.revision + 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            vitals: [],
          };
        }
        data = { consultation: records[id] };
      } else if (url.startsWith("/api/medicines/search"))
        data = { medicines: [] };
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

function fieldElement(field: string) {
  const element = screen
    .getByRole("textbox", { name: "Prescription document" })
    .querySelector(`[data-record-field="${field}"] .record-value`);
  if (!element) throw new Error(`Document field not found: ${field}`);
  return element;
}
async function writeField(field: string, value: string) {
  await act(async () => {
    const element = fieldElement(field);
    element.textContent = value;
    fireEvent.input(element);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("doctor workspace", () => {
  it("puts reviewed dictation in the selected prescription field and saves its projection", async () => {
    render(<App />);
    await writeField("patient.name", "Synthetic dictation mapping");
    await writeField("complaints", "Existing complaint");
    await writeField("advice", "Existing advice");
    fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
    const destination = screen.getByLabelText("Prescription field") as HTMLSelectElement;
    const advice = Array.from(destination.options).find(option => option.textContent === "Advice")!;
    fireEvent.change(destination, { target: { value: advice.value } });
    fireEvent.change(screen.getByLabelText("Recognized text"), { target: { value: "Reviewed instruction\n0.500 mg exactly" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Advice" }));
    fireEvent.click(screen.getByRole("button", { name: "Save consultation" }));
    await waitFor(() => expect(Object.values(records)).toHaveLength(1));
    const saved = Object.values(records)[0];
    expect(saved.patient.name).toBe("Synthetic dictation mapping");
    expect(saved.complaints).toBe("Existing complaint");
    expect(saved.advice).toBe("Existing advice\nReviewed instruction\n0.500 mg exactly");
    expect((screen.getByLabelText("Recognized text") as HTMLTextAreaElement).value).toBe("");
  });
  it("keeps a real table and placed signature when saving an authored document", async () => {
    render(<App />);
    await writeField("patient.name", "Synthetic document integration");
    await writeField("clinician.name", "Synthetic prescriber");
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(
      screen
        .getByRole("textbox", { name: "Prescription document" })
        .querySelector("table"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
    const file = new File(
      [Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))],
      "test-signature.png",
      { type: "image/png" },
    );
    fireEvent.change(screen.getByLabelText("Upload image"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Place signature" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Place signature" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save consultation" }));
    await waitFor(() => expect(Object.values(records)).toHaveLength(1));
    const saved = Object.values(records)[0];
    const nodes = (node: any): any[] => [node, ...(node.content || []).flatMap(nodes)];
    const allNodes = nodes(saved.document);
    expect(saved.patient.name).toBe("Synthetic document integration");
    expect(saved.clinician.name).toBe("Synthetic prescriber");
    expect(
      allNodes.some((node: any) => node.type === "table"),
    ).toBe(true);
    expect(
      allNodes.some((node: any) => node.type === "signature"),
    ).toBe(true);
    expect(
      allNodes.filter(
        (node: any) => node.attrs?.field === "patient.name",
      ),
    ).toHaveLength(1);
  });
  it("authors exact medication text, saves, navigates, and reopens the visit", async () => {
    render(<App />);
    await writeField("patient.name", "Synthetic UI test");
    fireEvent.click(
      screen.getByRole("button", { name: "Add a medicine manually" }),
    );
    await writeField("name", "Test product");
    await writeField("dose", "0.500 mg");
    await writeField("frequency", "প্রতিদিন");
    expect(fieldElement("patient.name").closest("[data-prescription-section]")?.getAttribute("data-prescription-section")).toBe("patient");
    expect(fieldElement("name").closest(".prescription-rx")).not.toBeNull();
    expect(fieldElement("name").closest(".record-field")!.classList.contains("is-empty")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save consultation" }));
    await waitFor(() => expect(Object.values(records)).toHaveLength(1));
    expect(Object.values(records)[0].medications[0].dose).toBe("0.500 mg");
    fireEvent.click(screen.getByRole("button", { name: "Patient records" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(fieldElement("dose").textContent).toBe("0.500 mg"),
    );
    expect(fieldElement("frequency").textContent).toBe("প্রতিদিন");
    expect(Object.values(records)[0].document.type).toBe("doc");
  });
  it("retains edits while navigating and exposes the complete product inventory", async () => {
    render(<App />);
    await writeField("patient.name", "Retained patient");
    fireEvent.click(screen.getByRole("button", { name: "Product showcase" }));
    expect(coverage).toHaveLength(125);
    expect(new Set(coverage.map((r) => r.id)).size).toBe(125);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search product requirements" }),
      { target: { value: "D49" } },
    );
    expect(screen.getByText("D49")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Prescription studio" }),
    );
    expect(fieldElement("patient.name").textContent).toBe("Retained patient");
  });
  it("keeps the app M mark, selects English by default, and saves the chosen label language without rewriting text", async () => {
    render(<App />);
    expect(document.querySelector(".sidebar .brand-logo")?.textContent).toBe("m+");
    expect(document.querySelector(".sidebar .hospital-brand")).toBeNull();
    expect((screen.getByLabelText("Prescription language") as HTMLSelectElement).value).toBe("en");
    await writeField("patient.name", "Synthetic language test");
    await writeField("advice", "Keep this authored English advice.");
    fireEvent.change(screen.getByLabelText("Prescription language"), { target: { value: "bn" } });
    await waitFor(() => expect(fieldElement("patient.name").closest(".record-field")!.getAttribute("data-label")).toBe("নাম"));
    expect(fieldElement("advice").textContent).toBe("Keep this authored English advice.");
    fireEvent.click(screen.getByRole("button", { name: "Save consultation" }));
    await waitFor(() => expect(Object.values(records)).toHaveLength(1));
    expect(Object.values(records)[0].language).toBe("bn");
    fireEvent.change(screen.getByLabelText("Prescription language"), { target: { value: "en" } });
    await waitFor(() => expect(fieldElement("patient.name").closest(".record-field")!.getAttribute("data-label")).toBe("Name"));
    expect(fieldElement("advice").textContent).toBe("Keep this authored English advice.");
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    const preview = within(screen.getByRole("dialog", { name: "Review the prescription" })).getByLabelText("Prescription preview");
    expect(preview.querySelectorAll(".prescription-patient")).toHaveLength(1);
    expect(preview.querySelector(".prescription-patient")!.textContent).toContain("Synthetic language test");
    expect(preview.querySelector(".prescription-rx")!.textContent).toContain("Keep this authored English advice.");
  });
  it("opens the command menu with the keyboard and closes it with Escape", () => {
    render(<App />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Quick actions" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("checks missing fields without claiming an AI or safety result", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Clinical assistant/ }));
    const dialog = screen.getByRole("dialog", { name: "Clinical assistant" });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Review missing information",
      }),
    );
    expect(within(dialog).getByText("Local completeness check")).toBeTruthy();
    expect(
      within(dialog).getByText("Allergy information has not been recorded."),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Ask assistant" }),
    ).toHaveProperty("disabled", true);
  });
  it("imports exact drafts as new records without importing measurement or artifact authority", () => {
    const draft = newConsultation();
    draft.medications = [
      { ...blankMedication(), name: "Example", dose: "0.500 mg" },
    ];
    draft.vitalReadingIds = [crypto.randomUUID()];
    draft.sources = [
      { artifactId: "a".repeat(64), name: "source.png", fields: ["advice"] },
    ];
    const imported = importDraft({ format: "meddesk-draft/1", draft });
    expect(imported.id).not.toBe(draft.id);
    expect(imported.revision).toBe(0);
    expect(imported.medications[0].dose).toBe("0.500 mg");
    expect(imported.vitalReadingIds).toEqual([]);
    expect(imported.sources).toEqual([]);
    expect(() => importDraft({ format: "lps", draft })).toThrow(
      /MedDesk draft/,
    );
  });
});
