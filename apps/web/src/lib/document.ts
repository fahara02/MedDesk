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

export const prescriptionLabels: Record<string, string> = {
  "patient.name": "Name", "patient.age": "Age", "patient.sex": "Sex", "patient.reference": "Patient ID", "patient.address": "Address",
  "clinician.name": "Doctor", "clinician.clinic": "Practice", "clinician.registration": "BMDC Reg. No.",
  "clinician.qualifications": "Qualifications", "clinician.designation": "Designation", "clinician.address": "Chamber", "clinician.phone": "Appointments",
  date: "Date", complaints: "C/C", history: "History", allergies: "Allergies", examination: "O/E", assessment: "Assessment / Dx",
  investigations: "Investigations", advice: "Advice", nutrition: "Diet", followUp: "Follow-up",
  bloodPressure: "BP", pulse: "Pulse", temperature: "Temp.", weight: "Weight", spo2: "SpO₂",
  ...Object.fromEntries(medicationFields),
};
const bengaliLabels: Record<string, string> = {
  "patient.name": "নাম", "patient.age": "বয়স", "patient.sex": "লিঙ্গ", "patient.reference": "রোগীর আইডি", "patient.address": "ঠিকানা",
  "clinician.name": "চিকিৎসক", "clinician.clinic": "চেম্বার", "clinician.registration": "বিএমডিসি রেজি. নং",
  "clinician.qualifications": "শিক্ষাগত যোগ্যতা", "clinician.designation": "পদবি", "clinician.address": "চেম্বারের ঠিকানা", "clinician.phone": "যোগাযোগ",
  date: "তারিখ", complaints: "প্রধান অভিযোগ", history: "রোগের ইতিহাস", allergies: "অ্যালার্জি", examination: "শারীরিক পরীক্ষা", assessment: "মূল্যায়ন / রোগনির্ণয়",
  investigations: "পরীক্ষা-নিরীক্ষা", advice: "পরামর্শ", nutrition: "খাদ্যাভ্যাস", followUp: "পুনরায় সাক্ষাৎ",
  bloodPressure: "রক্তচাপ", pulse: "নাড়ি", temperature: "তাপমাত্রা", weight: "ওজন", spo2: "SpO₂",
  name: "ওষুধ", generic: "জেনেরিক", strength: "শক্তি", form: "ধরন", dose: "মাত্রা", route: "প্রয়োগপথ", frequency: "সেবনের সময়", duration: "মেয়াদ", quantity: "পরিমাণ", instructions: "নির্দেশনা",
};
function labelDocument(document: DocumentNode, language: "en" | "bn"): DocumentNode {
  const labels = language === "bn" ? bengaliLabels : prescriptionLabels;
  const visit = (node: DocumentNode): DocumentNode => ({ ...node,
    ...(node.type === "recordField" && labels[String(node.attrs?.field)] ? { attrs: { ...node.attrs, label: labels[String(node.attrs?.field)] } } : {}),
    ...(node.content ? { content: node.content.map(visit) } : {}) });
  return visit(document);
}
const noteFields = new Set(["complaints", "history", "allergies", "examination", "assessment", "investigations", "bloodPressure", "pulse", "temperature", "weight", "spo2"]);
const afterRx = new Set(["advice", "nutrition", "followUp"]);
function section(kind: string, content: DocumentNode[]): DocumentNode {
  return { type: "prescriptionSection", attrs: { kind }, content: content.length ? content : [{ type: "paragraph" }] };
}
export function findSection(document: DocumentNode, kind: string): DocumentNode | undefined {
  if (document.type === "prescriptionSection" && document.attrs?.kind === kind) return document;
  for (const child of document.content || []) { const found = findSection(child, kind); if (found) return found; }
}

/** Reflow legacy flat documents without rebuilding or discarding authored content. */
export function formatPrescription(document: DocumentNode, language: "en" | "bn" = "en"): DocumentNode {
  if (findSection(document, "body")) return labelDocument(document, language);
  const header: DocumentNode[] = [], patient: DocumentNode[] = [], notes: DocumentNode[] = [], rx: DocumentNode[] = [], advice: DocumentNode[] = [], footer: DocumentNode[] = [];
  let rxHeading = false;
  for (const source of document.content || []) {
    const node = structuredClone(source), field = String(node.attrs?.field || "");
    if (node.type === "recordField") {
      if (prescriptionLabels[field]) node.attrs = { ...node.attrs, label: prescriptionLabels[field] };
      if (["clinician.address", "clinician.phone"].includes(field)) footer.push(node);
      else if (field.startsWith("clinician.")) header.push(node);
      else if (field.startsWith("patient.") || field === "date") patient.push(node);
      else if (noteFields.has(field)) notes.push(node);
      else if (afterRx.has(field)) advice.push(node);
      else rx.push(node);
    } else if (node.type === "signature") footer.unshift(node);
    else if (node.type === "heading" && documentText(node) === "℞ Prescription") {
      rxHeading = true; rx.push({ ...node, content: [{ type: "text", text: "℞" }] });
    } else if (node.type === "horizontalRule" && header.length && !patient.length && !rx.length) {
      // The old generated header divider is supplied by the patient strip now.
    } else rx.push(node);
  }
  if (!rxHeading) rx.unshift({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "℞" }] });
  const existing = new Set<string>();
  const inspect = (node: DocumentNode) => { if (node.type === "recordField") existing.add(String(node.attrs?.field)); node.content?.forEach(inspect); };
  inspect(document);
  for (const field of ["patient.address", "clinician.qualifications", "clinician.designation", "clinician.address", "clinician.phone"])
    if (!existing.has(field)) (field === "patient.address" ? patient : ["clinician.address", "clinician.phone"].includes(field) ? footer : header).push(fieldNode(field, prescriptionLabels[field]));
  const order = ["patient.name", "patient.age", "patient.sex", "date", "patient.reference", "patient.address"];
  patient.sort((a, b) => order.indexOf(String(a.attrs?.field)) - order.indexOf(String(b.attrs?.field)));
  const noteOrder = ["complaints", "history", "allergies", "examination", "bloodPressure", "pulse", "temperature", "weight", "spo2", "assessment", "investigations"];
  notes.sort((a, b) => noteOrder.indexOf(String(a.attrs?.field)) - noteOrder.indexOf(String(b.attrs?.field)));
  header.sort((a, b) => ["clinician.name", "clinician.qualifications", "clinician.designation", "clinician.clinic", "clinician.registration"].indexOf(String(a.attrs?.field)) - ["clinician.name", "clinician.qualifications", "clinician.designation", "clinician.clinic", "clinician.registration"].indexOf(String(b.attrs?.field)));
  return labelDocument({ ...document, content: [section("header", header), section("patient", patient),
    section("body", [section("notes", notes), section("rx", [...rx, ...advice])]), section("footer", footer)] }, language);
}

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
  if (draft.document) return formatPrescription(draft.document, draft.language);
  return formatPrescription({
    type: "doc",
    content: [
      fieldNode("clinician.clinic", "Clinic", draft.clinician.clinic),
      fieldNode("clinician.name", "Doctor", draft.clinician.name),
      ...(["qualifications", "designation", "address", "phone"] as const).map(key => fieldNode(`clinician.${key}`, prescriptionLabels[`clinician.${key}`], draft.clinician[key] || "")),
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
      fieldNode("patient.address", "Address", draft.patient.address || ""),
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
        .map(([key, value]) => fieldNode(key, key, value)),
      { type: "paragraph" },
    ],
  }, draft.language);
}
export function appendMedicine(
  draft: ConsultationInput,
  medicine: MedicationOrder,
): ConsultationInput {
  if (!draft.document)
    return { ...draft, medications: [...draft.medications, medicine] };
  const document = structuredClone(initialDocument(draft));
  const target = findSection(document, "rx")!;
  const advice = target.content!.findIndex(node => afterRx.has(String(node.attrs?.field)));
  target.content!.splice(
    advice < 0 ? target.content!.length : advice,
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
  const document = structuredClone(initialDocument(previous));
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
    "patient.address",
    "clinician.name",
    "clinician.registration",
    "clinician.clinic",
    "clinician.qualifications", "clinician.designation", "clinician.address", "clinician.phone",
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
      (findSection(document, field.startsWith("patient.") || field === "date" ? "patient" : ["clinician.address", "clinician.phone"].includes(field) ? "footer" : field.startsWith("clinician.") ? "header" : noteFields.has(field) ? "notes" : "rx") || document).content!.push(
        fieldNode(
          field,
          prescriptionLabels[field] || field,
          text,
        ),
      );
  return applyDocument(next, document);
}
