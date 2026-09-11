import type { ConsultationInput, MedicationOrder } from "./clinical-model.js";
import type { DocumentNode } from "./document-model.js";
export const clinicalFields = [
  ["complaints", "Presenting complaints"],
  ["history", "History"],
  ["allergies", "Allergies"],
  ["examination", "Examination"],
  ["assessment", "Assessment"],
  ["investigations", "Investigations"],
  ["advice", "Advice"],
  ["nutrition", "Diet & nutrition"],
  ["followUp", "Follow-up"],
] as const;
export const medicationFields = [
  ["name", "Medicine"],
  ["generic", "Generic"],
  ["strength", "Strength"],
  ["form", "Form"],
  ["dose", "Dose"],
  ["route", "Route"],
  ["frequency", "Frequency"],
  ["duration", "Duration"],
  ["quantity", "Quantity"],
  ["instructions", "Instructions"],
] as const;
const plainText = (node: DocumentNode): string =>
  node.type === "hardBreak"
    ? "\n"
    : node.text || (node.content || []).map(plainText).join("");
export function applyDocument(
  draft: ConsultationInput,
  document: DocumentNode,
): ConsultationInput {
  const next: ConsultationInput = {
    ...draft,
    document,
    date: "",
    patient: { ...draft.patient, name: "", age: "", sex: "", reference: "" },
    clinician: { name: "", registration: "", clinic: "" },
    medications: [],
    manualVitals: {
      bloodPressure: "",
      pulse: "",
      temperature: "",
      weight: "",
      spo2: "",
    },
  };
  for (const [field] of clinicalFields) next[field] = "";
  const visit = (node: DocumentNode, medication?: MedicationOrder) => {
    if (node.type === "medicationBlock") {
      const item: MedicationOrder = {
        id: String(node.attrs?.id || ""),
        catalogId: String(node.attrs?.catalogId || ""),
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
      (node.content || []).forEach((child) => visit(child, item));
      next.medications.push(item);
      return;
    }
    if (node.type === "recordField") {
      const field = String(node.attrs?.field),
        value = plainText(node);
      if (medication && medicationFields.some(([key]) => key === field))
        Object.assign(medication, { [field]: value });
      else if (field.startsWith("patient."))
        Object.assign(next.patient, { [field.slice(8)]: value });
      else if (field.startsWith("clinician."))
        Object.assign(next.clinician, { [field.slice(10)]: value });
      else if (field in next.manualVitals)
        Object.assign(next.manualVitals, { [field]: value });
      else if (
        field === "date" ||
        clinicalFields.some(([key]) => key === field)
      )
        Object.assign(next, { [field]: value });
    } else (node.content || []).forEach((child) => visit(child, medication));
  };
  visit(document);
  return next;
}
export function sameProjection(
  draft: ConsultationInput,
  document: DocumentNode,
) {
  const projection = applyDocument(draft, document);
  const values = (value: ConsultationInput) => [
    value.patient.name,
    value.patient.age,
    value.patient.sex,
    value.patient.reference,
    value.clinician.name,
    value.clinician.registration,
    value.clinician.clinic,
    value.date,
    ...clinicalFields.map(([field]) => value[field]),
    ...Object.values(value.manualVitals),
    value.medications.map((item) => [
      item.id,
      item.catalogId,
      ...medicationFields.map(([field]) => item[field]),
    ]),
  ];
  return JSON.stringify(values(projection)) === JSON.stringify(values(draft));
}
