import type { BandReading } from "./reading.js";
import { parseDocument, type DocumentNode } from "./document-model.js";
import { sameProjection } from "./document-projection.js";

export interface Patient {
  id: string;
  name: string;
  age: string;
  sex: string;
  reference: string;
}

export interface MedicationOrder {
  id: string;
  catalogId: string;
  name: string;
  generic: string;
  strength: string;
  form: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
}

export interface ConsultationInput {
  document?: DocumentNode;
  id: string;
  revision: number;
  patient: Patient;
  clinician: { name: string; registration: string; clinic: string };
  date: string;
  complaints: string;
  history: string;
  examination: string;
  assessment: string;
  advice: string;
  followUp: string;
  medications: MedicationOrder[];
  vitalReadingIds: string[];
  allergies: string;
  investigations: string;
  nutrition: string;
  synthetic: boolean;
  manualVitals: {
    bloodPressure: string;
    pulse: string;
    temperature: string;
    weight: string;
    spo2: string;
  };
  sources: { artifactId: string; name: string; fields: string[] }[];
}

export interface Consultation extends ConsultationInput {
  createdAt: string;
  updatedAt: string;
  vitals: BandReading[];
}

export interface ConsultationSummary {
  id: string;
  revision: number;
  patient: Patient;
  date: string;
  updatedAt: string;
  medicationCount: number;
  synthetic: boolean;
}

export const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  );
}

export function parseConsultation(
  input: unknown,
  allowUnnamed = false,
): ConsultationInput | null {
  if (
    !isRecord(input) ||
    !validId(input.id) ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0
  )
    return null;
  const { patient, clinician } = input;
  if (
    !isRecord(patient) ||
    !validId(patient.id) ||
    !text(patient.name, 160) ||
    (!allowUnnamed && !patient.name.trim()) ||
    !text(patient.age, 40) ||
    !text(patient.sex, 40) ||
    !text(patient.reference, 100)
  )
    return null;
  if (
    !isRecord(clinician) ||
    !text(clinician.name, 160) ||
    !text(clinician.registration, 100) ||
    !text(clinician.clinic, 400)
  )
    return null;
  if (
    typeof input.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(Date.parse(input.date)) ||
    new Date(input.date).toISOString().slice(0, 10) !== input.date
  )
    return null;
  for (const field of [
    "complaints",
    "history",
    "examination",
    "assessment",
    "advice",
    "followUp",
  ]) {
    if (!text(input[field], 8_000)) return null;
  }
  if (!Array.isArray(input.medications) || input.medications.length > 40)
    return null;
  const medications: MedicationOrder[] = [];
  for (const item of input.medications) {
    if (!isRecord(item) || !validId(item.id)) return null;
    const fields = [
      "catalogId",
      "name",
      "generic",
      "strength",
      "form",
      "dose",
      "route",
      "frequency",
      "duration",
      "quantity",
      "instructions",
    ] as const;
    if (
      fields.some(
        (field) => !text(item[field], field === "instructions" ? 2_000 : 300),
      )
    )
      return null;
    const medication = { id: item.id } as MedicationOrder;
    for (const field of fields) medication[field] = item[field] as string;
    medications.push(medication);
  }
  if (new Set(medications.map((item) => item.id)).size !== medications.length)
    return null;
  if (
    !Array.isArray(input.vitalReadingIds) ||
    input.vitalReadingIds.length > 30 ||
    !input.vitalReadingIds.every(validId) ||
    new Set(input.vitalReadingIds).size !== input.vitalReadingIds.length
  )
    return null;
  for (const field of ["allergies", "investigations", "nutrition"])
    if (!text(input[field] ?? "", 8_000)) return null;
  if (input.synthetic !== undefined && typeof input.synthetic !== "boolean")
    return null;
  const manual = input.manualVitals ?? {};
  if (!isRecord(manual)) return null;
  const manualVitals = {
    bloodPressure: "",
    pulse: "",
    temperature: "",
    weight: "",
    spo2: "",
  };
  for (const field of Object.keys(
    manualVitals,
  ) as (keyof typeof manualVitals)[]) {
    if (!text(manual[field] ?? "", 80)) return null;
    manualVitals[field] = (manual[field] as string) ?? "";
  }
  const sources: ConsultationInput["sources"] = [];
  const document =
    input.document === undefined ? undefined : parseDocument(input.document);
  if (document === null) return null;
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources) || input.sources.length > 20) return null;
    for (const source of input.sources) {
      if (
        !isRecord(source) ||
        typeof source.artifactId !== "string" ||
        !/^[a-f0-9]{64}$/.test(source.artifactId) ||
        !text(source.name, 200) ||
        !Array.isArray(source.fields) ||
        source.fields.length > 12 ||
        !source.fields.every((field) =>
          [
            "complaints",
            "history",
            "examination",
            "assessment",
            "advice",
            "allergies",
            "investigations",
            "nutrition",
            "followUp",
          ].includes(String(field)),
        )
      )
        return null;
      sources.push({
        artifactId: source.artifactId,
        name: source.name,
        fields: [...source.fields] as string[],
      });
    }
  }
  const result: ConsultationInput = {
    ...(document ? { document } : {}),
    id: input.id,
    revision: input.revision as number,
    patient: {
      id: patient.id,
      name: patient.name,
      age: patient.age,
      sex: patient.sex,
      reference: patient.reference,
    },
    clinician: {
      name: clinician.name,
      registration: clinician.registration,
      clinic: clinician.clinic,
    },
    date: input.date,
    complaints: input.complaints as string,
    history: input.history as string,
    examination: input.examination as string,
    assessment: input.assessment as string,
    advice: input.advice as string,
    followUp: input.followUp as string,
    medications,
    vitalReadingIds: [...input.vitalReadingIds],
    allergies: (input.allergies as string) ?? "",
    investigations: (input.investigations as string) ?? "",
    nutrition: (input.nutrition as string) ?? "",
    synthetic: input.synthetic === true,
    manualVitals,
    sources,
  };
  return result.document && !sameProjection(result, result.document)
    ? null
    : result;
}
