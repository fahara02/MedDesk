import { parseConsultation } from "../../../server/src/clinical-model";
import { practice } from "./branding";
import { workspaceFetch } from "./session";
export { parseConsultation };
export type {
  Patient,
  MedicationOrder,
  Consultation,
  ConsultationInput,
  ConsultationSummary,
} from "../../../server/src/clinical-model";
export type { Medicine, MedicineDetails } from "../../../server/src/catalog";
import type {
  ConsultationInput,
  MedicationOrder,
} from "../../../server/src/clinical-model";

export interface Capabilities {
  consultation: boolean;
  artifacts: boolean;
  nativeLps: boolean;
  ocr: boolean;
  assistant: boolean;
  neuralSpeech: boolean;
  signatures: boolean;
  pharmacyEvents: boolean;
  medicineCatalog: {
    count: number;
    files: number;
    issues: string[];
    reviewStatus: string;
  };
}
export interface Artifact {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await workspaceFetch(url, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "The request could not be completed.");
  return data as T;
}
export function blankMedication(): MedicationOrder {
  return {
    id: crypto.randomUUID(),
    catalogId: "",
    name: "",
    generic: "",
    strength: "",
    form: "",
    dose: "",
    route: "",
    frequency: "",
    duration: "",
    quantity: "",
    instructions: "",
  };
}
export function newConsultation(): ConsultationInput {
  const date = new Date();
  return {
    id: crypto.randomUUID(),
    revision: 0,
    patient: {
      id: crypto.randomUUID(),
      name: "",
      age: "",
      sex: "",
      reference: "",
    },
    clinician: { name: practice.clinician, registration: "", clinic: practice.name },
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    complaints: "",
    history: "",
    examination: "",
    assessment: "",
    advice: "",
    followUp: "",
    medications: [],
    vitalReadingIds: [],
    allergies: "",
    investigations: "",
    nutrition: "",
    synthetic: false,
    manualVitals: {
      bloodPressure: "",
      pulse: "",
      temperature: "",
      weight: "",
      spo2: "",
    },
    sources: [],
  };
}
export function exampleConsultation(): ConsultationInput {
  const draft = newConsultation();
  return {
    ...draft,
    synthetic: true,
    patient: {
      ...draft.patient,
      name: "Ayesha Rahman",
      age: "32 years",
      sex: "Female",
      reference: "DEMO-001",
    },
    clinician: {
      name: "Demo clinician",
      registration: "Demonstration only",
      clinic: "Meadow Clinic · Fictional practice",
    },
    complaints: "Follow-up visit to discuss the patient’s recorded symptoms.",
    history:
      "Synthetic example for exploring the workspace. No real patient information.",
    assessment: "Assessment to be entered by the reviewing clinician.",
    advice: "Bring previous reports to the next consultation.",
    followUp: "To be arranged after review.",
  };
}
export function importDraft(value: unknown): ConsultationInput {
  const envelope = value as { format?: unknown; draft?: unknown };
  if (envelope?.format !== "meddesk-draft/1")
    throw new Error(
      "Choose a MedDesk draft JSON file. Native .lps reading requires the core bridge.",
    );
  const draft = parseConsultation(envelope.draft, true);
  if (!draft)
    throw new Error(
      "The file contains invalid or incomplete consultation fields.",
    );
  // An import is a new local draft; external IDs cannot overwrite an existing record.
  return {
    ...draft,
    id: crypto.randomUUID(),
    revision: 0,
    vitalReadingIds: [],
    sources: [],
  };
}
export function serializeDraft(draft: ConsultationInput) {
  return JSON.stringify({ format: "meddesk-draft/1", draft }, null, 2);
}
export function download(
  name: string,
  contents: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const clinicalSections = [
  ["complaints", "Presenting complaints"],
  ["history", "Clinical history"],
  ["allergies", "Allergies & reactions"],
  ["examination", "Examination"],
  ["assessment", "Assessment"],
  ["investigations", "Investigations"],
  ["advice", "Advice & follow-up care"],
  ["nutrition", "Diet & nutrition"],
  ["followUp", "Next review"],
] as const;
export function reviewIssues(draft: ConsultationInput) {
  const issues: string[] = [];
  if (!draft.patient.name.trim()) issues.push("Enter the patient’s name.");
  if (!draft.clinician.name.trim()) issues.push("Enter the prescriber’s name.");
  if (!draft.clinician.registration.trim())
    issues.push("Enter the prescriber’s registration.");
  if (!draft.allergies.trim())
    issues.push("Allergy information has not been recorded.");
  for (const [index, med] of draft.medications.entries()) {
    const missing = (
      ["name", "dose", "route", "frequency", "duration"] as const
    ).filter((key) => !med[key].trim());
    if (missing.length)
      issues.push(`Medicine ${index + 1}: enter ${missing.join(", ")}.`);
  }
  return issues;
}
