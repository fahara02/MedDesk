import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { clinicalFields, medicationFields, prescriptionLabels } from "./document";

export interface DictationTarget {
  id: string;
  label: string;
  group: string;
  value: string;
  from: number;
  to: number;
}
export type DictationAction = "append" | "replace";

const labels: Record<string, string> = {
  ...prescriptionLabels,
  ...Object.fromEntries(clinicalFields),
  complaints: "Chief complaints (C/C)", examination: "Examination (O/E)", assessment: "Diagnosis / assessment",
  "patient.name": "Patient name", "patient.age": "Age", "patient.sex": "Sex",
  "patient.reference": "Patient ID", "patient.address": "Patient address",
};
const clinical = new Set<string>(clinicalFields.map(([key]) => key));
const medication = new Set<string>(medicationFields.map(([key]) => key));
const vitals = new Set(["bloodPressure", "pulse", "temperature", "weight", "spo2"]);

export function dictationTargets(doc: Node): DictationTarget[] {
  const targets: DictationTarget[] = [];
  const medicines = new Map<Node, string>();
  let medicineNumber = 0;
  doc.descendants((node, pos, parent) => {
    if (node.type.name === "medicationBlock") {
      medicineNumber++;
      const name = node.children.find(child => child.attrs.field === "name")?.textContent;
      medicines.set(node, `Rx ${medicineNumber} · ${name || "Unnamed medicine"}`);
    }
    if (node.type.name !== "recordField") return;
    const field = String(node.attrs.field);
    const isMedicine = parent?.type.name === "medicationBlock";
    if (isMedicine ? !medication.has(field) || !parent.attrs.id
      : !clinical.has(field) && !vitals.has(field) && !field.startsWith("patient.") && field !== "date") return;
    if (!labels[field]) return;
    const group = isMedicine ? medicines.get(parent)!
      : field.startsWith("patient.") || field === "date" ? "Patient details · top strip"
      : vitals.has(field) ? "Observations · O/E"
      : ["advice", "nutrition", "followUp"].includes(field) ? "Plan · below medicines" : "Clinical notes · left column";
    const label = isMedicine ? `${group} — ${labels[field]}` : labels[field];
    targets.push({ id: JSON.stringify([isMedicine ? String(parent.attrs.id) : null, field]),
      group, label, value: node.textBetween(0, node.content.size, "", "\n"), from: pos + 1, to: pos + node.nodeSize - 1 });
  });
  // Ambiguous fields must never silently resolve to the first occurrence.
  const counts = new Map<string, number>();
  for (const target of targets) counts.set(target.id, (counts.get(target.id) || 0) + 1);
  return targets.filter(target => counts.get(target.id) === 1);
}

export function applyDictation(editor: Editor, targetId: string, text: string, action: DictationAction): boolean {
  if (editor.isDestroyed || !text.trim() || !["append", "replace"].includes(action)) return false;
  // Resolve against the current document: cursor movement and medicine reordering cannot redirect text.
  const target = dictationTargets(editor.state.doc).find(item => item.id === targetId);
  if (!target) return false;
  const schema = editor.state.schema;
  const content: Node[] = [];
  if (action === "append" && target.from !== target.to) content.push(schema.nodes.hardBreak.create());
  text.split(/\r\n|\r|\n/).forEach((line, index) => {
    if (index) content.push(schema.nodes.hardBreak.create());
    if (line) content.push(schema.text(line));
  });
  const start = action === "replace" ? target.from : target.to;
  const transaction = closeHistory(editor.state.tr).replaceWith(start, target.to, content);
  transaction.setSelection(TextSelection.create(transaction.doc, start + content.reduce((size, node) => size + node.nodeSize, 0)));
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}
