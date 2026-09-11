export interface DocumentNode {
  type: string;
  text?: string;
  attrs?: Record<string, string | number | number[] | boolean | null>;
  marks?: {
    type: string;
    attrs?: Record<string, string | number | boolean | null>;
  }[];
  content?: DocumentNode[];
}

const nodeTypes = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "hardBreak",
  "horizontalRule",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "recordField",
  "medicationBlock",
  "signature",
]);
const markTypes = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
  "textStyle",
]);
const fields = new Set([
  "patient.name",
  "patient.age",
  "patient.sex",
  "patient.reference",
  "clinician.name",
  "clinician.registration",
  "clinician.clinic",
  "date",
  "complaints",
  "history",
  "allergies",
  "examination",
  "assessment",
  "investigations",
  "advice",
  "nutrition",
  "followUp",
  "bloodPressure",
  "pulse",
  "temperature",
  "weight",
  "spo2",
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
]);

export function parseDocument(value: unknown): DocumentNode | null {
  let nodes = 0,
    bytes = 0;
  function parse(input: unknown, depth: number): DocumentNode | null {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      depth > 20 ||
      ++nodes > 5000
    )
      return null;
    const raw = input as Record<string, unknown>;
    if (typeof raw.type !== "string" || !nodeTypes.has(raw.type)) return null;
    const node: DocumentNode = { type: raw.type };
    if (raw.text !== undefined) {
      if (
        typeof raw.text !== "string" ||
        raw.type !== "text" ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw.text)
      )
        return null;
      bytes += raw.text.length;
      node.text = raw.text;
    }
    if (raw.attrs !== undefined) {
      if (
        !raw.attrs ||
        typeof raw.attrs !== "object" ||
        Array.isArray(raw.attrs)
      )
        return null;
      node.attrs = {};
      for (const [key, item] of Object.entries(raw.attrs)) {
        if (
          key === "colwidth" &&
          Array.isArray(item) &&
          ["tableCell", "tableHeader"].includes(raw.type) &&
          item.length <= 30 &&
          item.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 4000)
        ) {
          node.attrs[key] = item;
          continue;
        }
        if (
          !["string", "number", "boolean"].includes(typeof item) &&
          item !== null
        )
          return null;
        if (typeof item === "number" && !Number.isFinite(item)) return null;
        if (typeof item === "string") bytes += item.length;
        node.attrs[key] = item as string | number | boolean | null;
      }
    }
    if (raw.type === "recordField" && !fields.has(String(node.attrs?.field)))
      return null;
    if (
      raw.type === "signature" &&
      (!/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(
        String(node.attrs?.src),
      ) ||
        String(node.attrs?.src).length > 300000)
    )
      return null;
    if (raw.type === "signature") {
      const source = String(node.attrs?.src);
      if (
        !(
          source.startsWith("data:image/png;base64,iVBORw0KGgo") ||
          source.startsWith("data:image/jpeg;base64,/9j/")
        )
      )
        return null;
      if (
        node.attrs?.width !== undefined &&
        (!Number.isInteger(node.attrs.width) ||
          Number(node.attrs.width) < 40 ||
          Number(node.attrs.width) > 700)
      )
        return null;
      if (
        node.attrs?.align !== undefined &&
        !["left", "center", "right"].includes(String(node.attrs.align))
      )
        return null;
    }
    if (raw.marks !== undefined) {
      if (!Array.isArray(raw.marks) || raw.marks.length > 8) return null;
      node.marks = [];
      for (const mark of raw.marks) {
        if (!mark || !markTypes.has(mark.type)) return null;
        if (mark.type === "link") {
          if (
            typeof mark.attrs?.href !== "string" ||
            !/^https?:\/\//.test(mark.attrs.href)
          )
            return null;
          node.marks.push({ type: "link", attrs: { href: mark.attrs.href } });
        } else node.marks.push({ type: mark.type });
      }
    }
    if (raw.content !== undefined) {
      if (!Array.isArray(raw.content)) return null;
      node.content = [];
      for (const child of raw.content) {
        const parsed = parse(child, depth + 1);
        if (!parsed) return null;
        node.content.push(parsed);
      }
    }
    return bytes > 500000 ? null : node;
  }
  const doc = parse(value, 0);
  if (doc?.type !== "doc" || !doc.content?.length) return null;
  const block = new Set([
    "paragraph",
    "heading",
    "horizontalRule",
    "bulletList",
    "orderedList",
    "blockquote",
    "codeBlock",
    "table",
    "recordField",
    "medicationBlock",
    "signature",
  ]);
  const inline = new Set(["text", "hardBreak"]);
  const seenFields = new Set<string>(),
    seenMedicines = new Set<string>();
  function valid(node: DocumentNode, parent: string, scope: string): boolean {
    const children = node.content || [];
    if (node.type === "text")
      return (
        typeof node.text === "string" &&
        node.text.length > 0 &&
        !children.length
      );
    if (["hardBreak", "horizontalRule", "signature"].includes(node.type))
      return children.length === 0;
    if (node.type === "doc" && parent) return false;
    if (node.type === "medicationBlock") {
      const id = String(node.attrs?.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id) || seenMedicines.has(id)) return false;
      seenMedicines.add(id);
      scope = id;
    }
    if (node.type === "recordField") {
      const name = String(node.attrs?.field);
      const medication = [
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
      ].includes(name);
      if (medication !== (parent === "medicationBlock")) return false;
      const key = scope + ":" + name;
      if (seenFields.has(key)) return false;
      seenFields.add(key);
    }
    const allowed = ["paragraph", "heading", "recordField"].includes(node.type)
      ? inline
      : node.type === "codeBlock"
        ? new Set(["text"])
        : ["bulletList", "orderedList"].includes(node.type)
          ? new Set(["listItem"])
          : node.type === "medicationBlock"
            ? new Set(["recordField"])
            : node.type === "table"
              ? new Set(["tableRow"])
              : node.type === "tableRow"
                ? new Set(["tableCell", "tableHeader"])
                : block;
    if (
      [
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "medicationBlock",
        "table",
        "tableRow",
        "tableCell",
        "tableHeader",
      ].includes(node.type) &&
      !children.length
    )
      return false;
    if (node.type === "listItem" && children[0]?.type !== "paragraph")
      return false;
    if (["tableCell", "tableHeader"].includes(node.type))
      for (const key of ["colspan", "rowspan"]) {
        const value = node.attrs?.[key];
        if (
          value !== undefined &&
          (!Number.isSafeInteger(value) ||
            Number(value) < 1 ||
            Number(value) > 30)
        )
          return false;
      }
    if (
      node.type === "heading" &&
      node.attrs?.level !== undefined &&
      (!Number.isInteger(node.attrs.level) ||
        Number(node.attrs.level) < 1 ||
        Number(node.attrs.level) > 6)
    )
      return false;
    return children.every(
      (child) => allowed.has(child.type) && valid(child, node.type, scope),
    );
  }
  return valid(doc, "", "document") ? doc : null;
}

export function documentText(node: DocumentNode): string {
  if (node.type === "signature")
    return `[Signature image: ${node.attrs?.signer || "Prescriber"}]`;
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const inline = ["paragraph", "heading", "recordField"].includes(node.type);
  const content = (node.content || [])
    .map(documentText)
    .join(inline ? "" : "\n");
  return node.type === "recordField"
    ? content.trim()
      ? `${node.attrs?.label || node.attrs?.field}: ${content}`
      : ""
    : content;
}
