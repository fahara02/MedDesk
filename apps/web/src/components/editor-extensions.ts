import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";

const RecordField = Node.create({
  name: "recordField",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes() {
    return { field: { default: "" }, label: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "p[data-record-field]",
        contentElement: ".record-value",
        getAttrs: (element) => ({
          field: element.getAttribute("data-record-field"),
          label: element.getAttribute("data-label"),
        }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "p",
      mergeAttributes(HTMLAttributes, {
        "data-record-field": node.attrs.field,
        "data-label": node.attrs.label,
        class: "record-field",
      }),
      [
        "span",
        { class: "record-label", contenteditable: "false" },
        node.attrs.label,
      ],
      ["span", { class: "record-value" }, 0],
    ];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () =>
        this.editor.isActive("recordField")
          ? this.editor.commands.setHardBreak()
          : false,
    };
  },
});
const MedicationBlock = Node.create({
  name: "medicationBlock",
  group: "block",
  content: "recordField+",
  defining: true,
  draggable: true,
  addAttributes() {
    return { id: { default: "" }, catalogId: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "article[data-medication]",
        contentElement: ".medication-fields",
        getAttrs: (element) => ({
          id: element.getAttribute("data-medication"),
          catalogId: element.getAttribute("data-catalog-id"),
        }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "article",
      mergeAttributes(HTMLAttributes, {
        "data-medication": node.attrs.id,
        "data-catalog-id": node.attrs.catalogId,
        class: "document-medication",
      }),
      [
        "div",
        { class: "medication-handle", contenteditable: "false" },
        "℞  Medication order",
      ],
      ["div", { class: "medication-fields" }, 0],
    ];
  },
});
const Signature = Node.create({
  name: "signature",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "" },
      signer: { default: "" },
      registration: { default: "" },
      placedAt: { default: "" },
      width: { default: 180 },
      align: { default: "right" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-signature]",
        getAttrs: (element) => ({
          src: element.querySelector("img")?.getAttribute("src"),
          signer: element.getAttribute("data-signer"),
          registration: element.getAttribute("data-registration"),
          placedAt: element.getAttribute("data-placed-at"),
          width: Number(element.getAttribute("data-width")) || 180,
          align: element.getAttribute("data-align") || "right",
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "figure",
      {
        "data-signature": "true",
        "data-signer": node.attrs.signer,
        "data-registration": node.attrs.registration,
        "data-placed-at": node.attrs.placedAt,
        "data-width": node.attrs.width,
        "data-align": node.attrs.align,
        class: "document-signature",
        style: `text-align:${node.attrs.align}`,
      },
      [
        "img",
        {
          src: node.attrs.src,
          alt: `Signature of ${node.attrs.signer}`,
          width: node.attrs.width,
        },
      ],
      [
        "figcaption",
        {},
        node.attrs.signer +
          (node.attrs.registration ? ` · ${node.attrs.registration}` : ""),
      ],
    ];
  },
});
export function documentExtensions() {
  return [
    StarterKit.configure({ link: { openOnClick: false } }),
    TableKit.configure({ table: { resizable: false } }),
    RecordField,
    MedicationBlock,
    Signature,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "recordField"
          ? "Click to write…"
          : "Write here, or insert a medicine from the tools panel…",
      includeChildren: true,
    }),
  ];
}
