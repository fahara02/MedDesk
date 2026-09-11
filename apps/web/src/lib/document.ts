import type { ConsultationInput, MedicationOrder } from "./clinic";
import {
  documentText,
  type DocumentNode,
} from "../../../server/src/document-model";
import {
  applyDocument,
  clinicalFields,
  medicationFields,
} from "../../../server/src/document-projection";
export { applyDocument, clinicalFields, medicationFields };
export { documentText };
export type { DocumentNode };

export function fieldNode(
  field: string,
  label: string,
  text = "",
): DocumentNode {
  return {
    type: "recordField",
    attrs: { field, label },
    content: text ? [{ type: "text", text }] : [],
  };
}
export function medicineNode(medicine: MedicationOrder): DocumentNode {
  return {
    type: "medicationBlock",
    attrs: { id: medicine.id, catalogId: medicine.catalogId },
    content: medicationFields.map(([key, label]) =>
      fieldNode(key, label, medicine[key]),
    ),
  };
}
export function initialDocument(draft: ConsultationInput): DocumentNode {
  if (draft.document) return draft.document;
  return {
    type: "doc",
    content: [
      fieldNode("clinician.clinic", "Clinic", draft.clinician.clinic),
      fieldNode("clinician.name", "Doctor", draft.clinician.name),
      fieldNode(
        "clinician.registration",
        "Registration",
        draft.clinician.registration,
      ),
      { type: "horizontalRule" },
      fieldNode("patient.name", "Patient", draft.patient.name),
      fieldNode("patient.age", "Age", draft.patient.age),
      fieldNode("patient.sex", "Sex", draft.patient.sex),
      fieldNode("patient.reference", "Patient ID", draft.patient.reference),
      fieldNode("date", "Date", draft.date),
      ...clinicalFields
        .slice(0, 5)
        .map(([key, label]) => fieldNode(key, label, draft[key])),
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "℞ Prescription" }],
      },
      ...draft.medications.map(medicineNode),
      { type: "paragraph" },
      ...clinicalFields
        .slice(5)
        .map(([key, label]) => fieldNode(key, label, draft[key])),
      ...Object.entries(draft.manualVitals)
        .filter(([, value]) => value)
        .map(([key, value]) => fieldNode(key, key, value)),
      { type: "paragraph" },
    ],
  };
}
export function appendMedicine(
  draft: ConsultationInput,
  medicine: MedicationOrder,
): ConsultationInput {
  if (!draft.document)
    return { ...draft, medications: [...draft.medications, medicine] };
  const document = structuredClone(draft.document);
  const advice = document.content!.findIndex(
    (node) => node.attrs?.field === "investigations",
  );
  document.content!.splice(
    advice < 0 ? document.content!.length : advice,
    0,
    medicineNode(medicine),
  );
  return applyDocument(draft, document);
}

export function syncDocumentFields(
  previous: ConsultationInput,
  next: ConsultationInput,
): ConsultationInput {
  if (!previous.document || next.document !== previous.document) return next;
  const document = structuredClone(previous.document);
  const value = (draft: ConsultationInput, field: string): string => {
    if (field.startsWith("patient."))
      return String(
        draft.patient[field.slice(8) as keyof typeof draft.patient] || "",
      );
    if (field.startsWith("clinician."))
      return String(
        draft.clinician[field.slice(10) as keyof typeof draft.clinician] || "",
      );
    if (field in draft.manualVitals)
      return draft.manualVitals[field as keyof typeof draft.manualVitals];
    return String(draft[field as keyof ConsultationInput] || "");
  };
  const changes = new Map<string, string>();
  const keys = [
    "patient.name",
    "patient.age",
    "patient.sex",
    "patient.reference",
    "clinician.name",
    "clinician.registration",
    "clinician.clinic",
    "date",
    ...clinicalFields.map(([field]) => field),
    ...Object.keys(next.manualVitals),
  ];
  for (const field of keys)
    if (value(previous, field) !== value(next, field))
      changes.set(field, value(next, field));
  const visit = (node: DocumentNode) => {
    if (node.type === "recordField" && changes.has(String(node.attrs?.field))) {
      const text = changes.get(String(node.attrs?.field))!;
      node.content = text ? [{ type: "text", text }] : [];
      changes.delete(String(node.attrs?.field));
    }
    (node.content || []).forEach(visit);
  };
  visit(document);
  for (const [field, text] of changes)
    if (text)
      document.content!.push(
        fieldNode(
          field,
          clinicalFields.find(([key]) => key === field)?.[1] || field,
          text,
        ),
      );
  return applyDocument(next, document);
}
