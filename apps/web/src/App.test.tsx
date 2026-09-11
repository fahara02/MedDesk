// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import App from "./App";
import { importDraft, newConsultation, blankMedication } from "./lib/clinic";
import coverage from "./content/coverage.json";

let records: Record<string, any>;
beforeEach(() => {
  records = {};
  localStorage.clear();
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("doctor workspace", () => {
  it("authors exact medication text, saves, navigates, and reopens the visit", async () => {
    render(<App />);
    const workspace = screen.getByRole("main");
    fireEvent.change(within(workspace).getByLabelText("Patient name"), {
      target: { value: "Synthetic UI test" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add a medicine manually" }),
    );
    fireEvent.change(screen.getByLabelText("Medicine name"), {
      target: { value: "Test product" },
    });
    fireEvent.change(screen.getByLabelText("Dose"), {
      target: { value: "0.500 mg" },
    });
    fireEvent.change(screen.getByLabelText("Frequency"), {
      target: { value: "প্রতিদিন" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save consultation" }));
    await waitFor(() => expect(Object.values(records)).toHaveLength(1));
    expect(Object.values(records)[0].medications[0].dose).toBe("0.500 mg");
    fireEvent.click(screen.getByRole("button", { name: "Patient records" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Dose")).toHaveProperty("value", "0.500 mg"),
    );
    expect(screen.getByLabelText("Frequency")).toHaveProperty(
      "value",
      "প্রতিদিন",
    );
  });
  it("retains edits while navigating and exposes the complete product inventory", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Patient name"), {
      target: { value: "Retained patient" },
    });
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
    expect(screen.getByLabelText("Patient name")).toHaveProperty(
      "value",
      "Retained patient",
    );
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
      within(dialog).getByRole("button", { name: /Send question/ }),
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
