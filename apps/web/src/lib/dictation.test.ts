// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { documentExtensions } from "../components/editor-extensions";
import { newConsultation, blankMedication, parseConsultation } from "./clinic";
import { initialDocument, applyDocument, findSection, type DocumentNode } from "./document";
import { applyDictation, dictationTargets } from "./dictation";

let editor: Editor;
const draft = () => {
  const visit = newConsultation();
  visit.patient.name = "Synthetic placement test";
  visit.complaints = "Existing complaint";
  visit.medications = [
    { ...blankMedication(), name: "First product", dose: "Keep first dose" },
    { ...blankMedication(), name: "Second product", dose: "Old second dose" },
  ];
  return visit;
};
beforeEach(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) });
});
afterEach(() => editor?.destroy());
const open = (document: DocumentNode) => {
  editor = new Editor({ extensions: documentExtensions(), content: document });
  // Let the editor's trailing-paragraph plugin establish its baseline before testing undo.
  editor.view.dispatch(editor.state.tr);
};

it("routes to the selected medicine ID after reordering and ignores the cursor in the patient header", () => {
  const visit = draft();
  open(initialDocument(visit));
  const destination = dictationTargets(editor.state.doc).find(item => item.label === "Rx 2 · Second product — Dose")!;
  const reordered = { ...visit, medications: [...visit.medications].reverse() };
  editor.commands.setContent(initialDocument(reordered));
  editor.commands.setTextSelection(dictationTargets(editor.state.doc).find(item => item.label === "Patient name")!.from);
  expect(applyDictation(editor, destination.id, "0.500 mg\n১+০+১", "replace")).toBe(true);
  const saved = applyDocument(visit, editor.getJSON() as DocumentNode);
  expect(saved.patient.name).toBe(visit.patient.name);
  expect(saved.complaints).toBe(visit.complaints);
  expect(saved.medications.find(item => item.id === visit.medications[0].id)?.dose).toBe("Keep first dose");
  expect(saved.medications.find(item => item.id === visit.medications[1].id)?.dose).toBe("0.500 mg\n১+০+১");
  expect(parseConsultation(saved)).not.toBeNull();
  expect(editor.state.selection.$from.parent.attrs.field).toBe("dose");
  expect(editor.state.selection.$from.node(-1).attrs.id).toBe(visit.medications[1].id);
});

it("refuses a removed or ambiguous destination without changing any document bytes", () => {
  const visit = draft();
  open(initialDocument(visit));
  const target = dictationTargets(editor.state.doc).find(item => item.label === "Rx 2 · Second product — Dose")!;
  editor.commands.setContent(initialDocument({ ...visit, medications: [visit.medications[0]] }));
  const before = editor.getJSON();
  expect(applyDictation(editor, target.id, "Wrong place", "append")).toBe(false);
  expect(editor.getJSON()).toEqual(before);
  const duplicate = initialDocument(visit);
  const notes = findSection(duplicate, "notes")!;
  notes.content!.push(structuredClone(notes.content!.find(node => node.attrs?.field === "complaints")!));
  editor.commands.setContent(duplicate);
  expect(applyDictation(editor, JSON.stringify([null, "complaints"]), "Ambiguous", "replace")).toBe(false);
});

it("appends exact text and line breaks without interpreting markup or replacing existing formatting, and supports undo", () => {
  const visit = draft(), document = initialDocument(visit);
  const complaint = findSection(document, "notes")!.content!.find(node => node.attrs?.field === "complaints")!;
  complaint.content![0].marks = [{ type: "bold" }];
  open(document);
  const before = editor.getJSON();
  const target = dictationTargets(editor.state.doc).find(item => item.label === "Chief complaints (C/C)")!;
  expect(applyDictation(editor, target.id, "  <b>literal</b>\n0.500 mg  ", "append")).toBe(true);
  const projected = applyDocument(visit, editor.getJSON() as DocumentNode);
  expect(projected.complaints).toBe("Existing complaint\n  <b>literal</b>\n0.500 mg  ");
  const updated = findSection(projected.document!, "notes")!.content!.find(node => node.attrs?.field === "complaints")!;
  expect(updated.content![0].marks).toEqual([{ type: "bold" }]);
  expect(updated.content!.find(node => node.text === "  <b>literal</b>")?.marks).toBeUndefined();
  expect(parseConsultation(projected)).not.toBeNull();
  expect(editor.commands.undo()).toBe(true);
  expect(editor.getJSON()).toEqual(before);
});

it("updates patient details and examination observations in their existing sections", () => {
  const visit = draft();
  open(initialDocument(visit));
  for (const [field, text] of [["patient.age", "35 years"], ["bloodPressure", "120/80 mmHg"], ["assessment", "Authored assessment"], ["followUp", "Authored follow-up"]])
    expect(applyDictation(editor, JSON.stringify([null, field]), text, "replace")).toBe(true);
  const saved = applyDocument(visit, editor.getJSON() as DocumentNode);
  expect(saved.patient.age).toBe("35 years");
  expect(saved.manualVitals.bloodPressure).toBe("120/80 mmHg");
  expect(saved.assessment).toBe("Authored assessment");
  expect(saved.followUp).toBe("Authored follow-up");
  expect(saved.medications).toEqual(visit.medications);
  expect(parseConsultation(saved)).not.toBeNull();
  expect(dictationTargets(editor.state.doc).some(item => item.label === "Doctor")).toBe(false);
});
