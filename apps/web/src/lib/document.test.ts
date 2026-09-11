import { expect, it } from "vitest";
import { initialDocument, formatPrescription, applyDocument, fieldNode, medicineNode, findSection, appendMedicine, syncDocumentFields, type DocumentNode } from "./document";
import { newConsultation, blankMedication, parseConsultation } from "./clinic";
import { parseDocument } from "../../../server/src/document-model";
import { sameProjection } from "../../../server/src/document-projection";

it("refuses non-text optional identity details while allowing older drafts", () => {
  const draft = newConsultation();
  expect(parseConsultation(draft, true)).not.toBeNull();
  expect(parseConsultation({ ...draft, patient: { ...draft.patient, address: null } }, true)).toBeNull();
  for (const key of ["qualifications", "designation", "address", "phone"])
    expect(parseConsultation({ ...draft, clinician: { ...draft.clinician, [key]: null } }, true)).toBeNull();
});

it("places patient data above separate notes and Rx columns without altering medication text", () => {
  const draft = newConsultation();
  draft.patient = { ...draft.patient, name: "Synthetic format test", age: "35 years", sex: "Female", address: "ঢাকা", reference: "TEST-003" };
  draft.clinician.qualifications = "User-entered qualification";
  draft.clinician.address = "User-entered chamber";
  draft.medications = [{ ...blankMedication(), name: "Test product", dose: "0.500 mg", frequency: "১+০+১", instructions: "Authored instructions only" }];
  draft.manualVitals.bloodPressure = "120/80 mmHg";
  draft.complaints = "Authored complaint";
  const document = initialDocument(draft);
  expect(document.content!.map(node => node.attrs?.kind)).toEqual(["header", "patient", "body", "footer"]);
  expect(findSection(document, "patient")!.content!.map(node => node.attrs?.field)).toEqual(["patient.name", "patient.age", "patient.sex", "date", "patient.reference", "patient.address"]);
  expect(findSection(document, "notes")!.content!.some(node => node.attrs?.field === "bloodPressure")).toBe(true);
  expect(findSection(document, "rx")!.content!.some(node => node.type === "medicationBlock")).toBe(true);
  expect(parseDocument(document)).not.toBeNull();
  expect(sameProjection(draft, document)).toBe(true);
  expect(parseConsultation(applyDocument(draft, document))!.medications).toEqual(draft.medications);
});

it("migrates old prescriptions preserving marks, tables, free text and signatures, and remains idempotent", () => {
  const table: DocumentNode = { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Exact table 0.500", marks: [{ type: "bold" }] }] }] }] }] };
  const signature: DocumentNode = { type: "signature", attrs: { src: "data:image/png;base64,iVBORw0KGgo=", signer: "Synthetic doctor" } };
  const medicine = { ...blankMedication(), name: "Old product", frequency: "প্রতিদিন", dose: "0.500 mg" };
  const old: DocumentNode = { type: "doc", content: [fieldNode("clinician.name", "Doctor", "Synthetic doctor"), fieldNode("patient.name", "Patient", "Synthetic patient"), fieldNode("date", "Date", "2026-09-12"), fieldNode("complaints", "Presenting complaints", "Original complaint"), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "℞ Prescription" }] }, medicineNode(medicine), table, { type: "paragraph", content: [{ type: "text", text: "Original free note", marks: [{ type: "italic" }] }] }, fieldNode("advice", "Advice", "Original advice"), signature] };
  const before = structuredClone(old), formatted = formatPrescription(old);
  expect(old).toEqual(before);
  expect(parseDocument(formatted)).not.toBeNull();
  expect(findSection(formatted, "rx")!.content).toContainEqual(table);
  expect(findSection(formatted, "footer")!.content).toContainEqual(signature);
  const projected = applyDocument(newConsultation(), old);
  expect(sameProjection(projected, formatted)).toBe(true);
  expect(formatPrescription(formatted)).toEqual(formatted);
  const updated = appendMedicine({ ...projected, document: old }, { ...blankMedication(), name: "Second product" });
  expect(updated.medications.map(item => item.name)).toEqual(["Old product", "Second product"]);
  expect(updated.medications[0].dose).toBe("0.500 mg");
});

it("English is the default and selected Bangla changes labels without translating authored clinical values", () => {
  const draft = newConsultation(); draft.patient.name = "Keep this name"; draft.advice = "Keep authored English advice";
  expect(draft.language).toBe("en");
  const english = initialDocument(draft), bengali = initialDocument({ ...draft, document: english, language: "bn" });
  expect(findSection(bengali, "patient")!.content![0].attrs!.label).toBe("নাম");
  expect(applyDocument(draft, bengali).advice).toBe(draft.advice);
  expect(sameProjection(draft, bengali)).toBe(true);
  expect(initialDocument({ ...draft, document: bengali, language: "en" })).toEqual(english);
  expect(parseConsultation({ ...draft, language: ["en"] })).toBeNull();
});

it("profile edits and manual observations reach their paper regions; contradictory documents still fail validation", () => {
  const draft = newConsultation(); draft.patient.name = "Synthetic profile test";
  const previous = applyDocument(draft, initialDocument(draft));
  const next = syncDocumentFields(previous, { ...previous, clinician: { ...previous.clinician, qualifications: "Exact qualification", phone: "TEST-CONTACT" }, manualVitals: { ...previous.manualVitals, weight: "60.00 kg" } });
  expect(parseConsultation(next)).not.toBeNull();
  expect(next.clinician.phone).toBe("TEST-CONTACT");
  expect(next.manualVitals.weight).toBe("60.00 kg");
  expect(parseConsultation({ ...next, patient: { ...next.patient, name: "Conflicting name" } })).toBeNull();
  const duplicate = structuredClone(next.document!); duplicate.content!.push(findSection(duplicate, "patient")!);
  expect(parseDocument(duplicate)).toBeNull();
  const invalid = structuredClone(next.document!); findSection(invalid, "body")!.content!.reverse();
  expect(parseDocument(invalid)).toBeNull();
});
