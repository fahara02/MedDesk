import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { ConsultationInput, Medicine } from "../lib/clinic";
import { api, blankMedication } from "../lib/clinic";
import {
  applyDocument,
  initialDocument,
  medicineNode,
  documentText,
  type DocumentNode,
} from "../lib/document";
import { documentExtensions } from "./editor-extensions";
import { Assistant } from "./Assistant";
import { SignatureTool } from "./SignatureTool";
import { SpeechTool } from "./SpeechTool";
import { DictationTool } from "./DictationTool";
import { Letterhead } from "./Letterhead";
import { practice } from "../lib/branding";
import { loadSavedSignature } from "../lib/signature";
import { applyDictation, dictationTargets } from "../lib/dictation";
import { Icon } from "./Icon";

export function Studio({
  draft,
  update,
  onNew,
  onFindPatient,
  onDevices,
  onExport,
  onExportLps,
  onOpenLps,
  onPdf,
  onReview,
  onSave,
  saving,
  dirty,
  storageError,
}: {
  draft: ConsultationInput;
  update: (draft: ConsultationInput) => void;
  onNew: () => void;
  onFindPatient: () => void;
  onFindMedicine: () => void;
  onDevices: () => void;
  onAssistant: () => void;
  onExport: () => void;
  onExportLps?: () => void;
  onOpenLps?: () => void;
  onPdf?: () => void;
  onReview: () => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  storageError: string;
}) {
  const current = useRef(draft);
  current.current = draft;
  const [tool, setTool] = useState("medicines"),
    [toolsOpen, setToolsOpen] = useState(true),
    [zoom, setZoom] = useState(100),
    [query, setQuery] = useState(""),
    [products, setProducts] = useState<Medicine[]>([]),
    [error, setError] = useState(""),
    [count, setCount] = useState<number | null>(null);
  const lastChange = useRef("");
  const editor = useEditor(
    {
      extensions: documentExtensions(),
      content: initialDocument(draft),
      editorProps: {
        attributes: {
          class: "prescription-document prescription-pad",
          role: "textbox",
          "aria-label": "Prescription document",
          "aria-multiline": "true",
          spellcheck: "true",
        },
      },
      onUpdate: ({ editor }) => {
        const document = editor.getJSON() as DocumentNode;
        lastChange.current = JSON.stringify(document);
        update(applyDocument(current.current, document));
      },
    },
    [draft.id],
  );
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold"),
      italic: editor?.isActive("italic"),
      underline: editor?.isActive("underline"),
      table: editor?.isActive("table"),
      signature: editor?.isActive("signature"),
      recordField: editor?.isActive("recordField"),
      canUndo: editor?.can().undo(),
      canRedo: editor?.can().redo(),
      dictationTargets: editor ? dictationTargets(editor.state.doc) : [],
    }),
  });
  useEffect(() => {
    if (!editor) return;
    const document = initialDocument(draft),
      serialized = JSON.stringify(document);
    if (
      serialized !== lastChange.current &&
      JSON.stringify(editor.getJSON()) !== serialized
    ) {
      editor.commands.setContent(document, { emitUpdate: false });
      lastChange.current = serialized;
    }
  }, [draft.document, draft.id, draft.language, editor]);
  useEffect(() => {
    if (!editor || draft.synthetic || draft.clinician.name !== practice.clinician) return;
    // The owner's saved image is part of this doctor's draft template.
    // Existing signatures and other prescribers' documents are retained.
    const abort = new AbortController();
    void loadSavedSignature(abort.signal).then(src => {
      if (!src || abort.signal.aborted || editor.isDestroyed || current.current.synthetic || current.current.clinician.name !== practice.clinician) return;
      let signed = false;
      editor.state.doc.descendants(node => { if (node.type.name === "signature") signed = true; });
      if (signed) return;
      editor.commands.insertContentAt(sectionPosition("footer"), {
        type: "signature", attrs: {
          src, signer: current.current.clinician.name,
          registration: current.current.clinician.registration,
          placedAt: new Date().toISOString(), width: 180, align: "right",
        },
      });
    }).catch(() => {});
    return () => abort.abort();
  }, [editor, draft.id]);
  useEffect(() => {
    void api<{ medicineCatalog: { count: number } }>("/api/capabilities")
      .then((value) => setCount(value.medicineCatalog.count))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      if (query.trim().length < 2) {
        setProducts([]);
        return;
      }
      void api<{ medicines: Medicine[] }>(
        `/api/medicines/search?q=${encodeURIComponent(query)}`,
        { signal: abort.signal },
      )
        .then((value) => {
          setProducts(value.medicines);
          setError("");
        })
        .catch((error) => {
          if (!abort.signal.aborted) setError(error.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);
  const insertMedicine = (product?: Medicine) => {
    if (!editor) return;
    if (draft.medications.length >= 40) {
      setError("This document has reached the 40-medicine limit.");
      return;
    }
    const item = {
      ...blankMedication(),
      ...(product
        ? {
            catalogId: product.id,
            name: product.name,
            generic: product.generic,
            strength: product.strength,
            form: product.form,
          }
        : {}),
    };
    let position = sectionPosition("rx");
    const parent = editor.state.selection.$from;
    for (let depth = parent.depth; depth > 0; depth--)
      if (parent.node(depth).type.name === "medicationBlock") position = parent.after(depth);
    editor
      .chain()
      .focus()
      .insertContentAt(position, [medicineNode(item), { type: "paragraph" }])
      .run();
  };
  function sectionPosition(kind: "rx" | "footer") {
    if (!editor) return 0;
    let position = editor.state.doc.content.size;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "prescriptionSection" || node.attrs.kind !== kind) return;
      position = pos + 1;
      for (const child of node.children) {
        if (child.type.name === "recordField" && ["advice", "nutrition", "followUp", "clinician.address", "clinician.phone"].includes(child.attrs.field)) break;
        position += child.nodeSize;
      }
      return false;
    });
    return position;
  }
  const insertBlocks = (content: DocumentNode[]) => {
    if (!editor) return false;
    const parent = editor.state.selection.$from;
    let position = editor.state.selection.from;
    for (let depth = parent.depth; depth > 0; depth--) {
      if (
        ["recordField", "medicationBlock"].includes(
          parent.node(depth).type.name,
        )
      )
        position = parent.after(depth);
      if (parent.node(depth).type.name === "prescriptionSection" && ["header", "patient"].includes(parent.node(depth).attrs.kind))
        position = sectionPosition("rx");
    }
    return editor.chain().focus().insertContentAt(position, content).run();
  };
  if (!editor) return null;
  return (
    <section className={`document-studio ${toolsOpen ? "with-tools" : ""}`}>
      <div className="document-topbar">
        <div>
          <span className="eyebrow">PRESCRIPTION STUDIO</span>
          <strong>{draft.patient.name || "New consultation"}</strong>
          <small>
            {saving
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : draft.revision
                  ? "Saved consultation"
                  : "New draft"}
          </small>
        </div>
        <div className="toolbar">
          <button className="button small" onClick={onNew}>
            New
          </button>
          <button className="button small" onClick={onFindPatient}>
            Open
          </button>
          <button className="button small" onClick={onExport}>
            Export draft
          </button>
          {draft.synthetic && onExportLps && <button className="button small" onClick={onExportLps}>Save as LPS</button>}
          {onOpenLps && <button className="button small" onClick={onOpenLps}>Open LPS</button>}
          {onPdf && <button className="button small" onClick={onPdf}>Save as PDF</button>}
          <button className="button small" onClick={onReview}>
            <Icon name="print" size={15} />
            Print
          </button>
          <button className="button primary" disabled={saving} onClick={onSave}>
            Save consultation
          </button>
          <button
            className="button"
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen(!toolsOpen)}
          >
            {toolsOpen ? "Hide tools" : "Show tools"}
          </button>
        </div>
      </div>
      <div
        className="document-formatbar"
        role="toolbar"
        aria-label="Document formatting"
      >
        <button
          title="Undo"
          aria-label="Undo"
          disabled={!state?.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        >
          ↶
        </button>
        <button
          title="Redo"
          aria-label="Redo"
          disabled={!state?.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        >
          ↷
        </button>
        <span className="toolbar-divider" />
        <select aria-label="Prescription language" value={draft.language || "en"} onChange={event => {
          const next = { ...draft, language: event.target.value as "en" | "bn" };
          update({ ...next, document: initialDocument(next) });
        }}>
          <option value="en">English</option><option value="bn">বাংলা</option>
        </select>
        <select
          aria-label="Paragraph style"
          disabled={state?.recordField}
          onChange={(event) => {
            const value = Number(event.target.value);
            value
              ? editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: value as 1 | 2 | 3 })
                  .run()
              : editor.chain().focus().setParagraph().run();
          }}
          defaultValue="0"
        >
          <option value="0">Normal text</option>
          <option value="1">Title</option>
          <option value="2">Heading</option>
          <option value="3">Subheading</option>
        </select>
        <button
          className={state?.bold ? "active" : ""}
          aria-label="Bold"
          aria-pressed={state?.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <b>B</b>
        </button>
        <button
          className={state?.italic ? "active" : ""}
          aria-label="Italic"
          aria-pressed={state?.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <i>I</i>
        </button>
        <button
          className={state?.underline ? "active" : ""}
          aria-label="Underline"
          aria-pressed={state?.underline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <u>U</u>
        </button>
        <span className="toolbar-divider" />
        <button
          aria-label="Bulleted list"
          disabled={state?.recordField}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • List
        </button>
        <button
          aria-label="Numbered list"
          disabled={state?.recordField}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </button>
        <button
          onClick={() =>
            insertBlocks([
              {
                type: "table",
                content: Array.from({ length: 3 }, (_, row) => ({
                  type: "tableRow",
                  content: Array.from({ length: 3 }, () => ({
                    type: row === 0 ? "tableHeader" : "tableCell",
                    content: [{ type: "paragraph" }],
                  })),
                })),
              },
              { type: "paragraph" },
            ])
          }
        >
          Table
        </button>
        <button
          onClick={() =>
            insertBlocks([{ type: "horizontalRule" }, { type: "paragraph" }])
          }
        >
          Divider
        </button>
        {state?.table && (
          <>
            <button onClick={() => editor.chain().focus().addRowAfter().run()}>
              + Row
            </button>
            <button
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              + Column
            </button>
            <button onClick={() => editor.chain().focus().deleteTable().run()}>
              Delete table
            </button>
          </>
        )}
        {state?.signature && (
          <>
            <button
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes("signature", { align: "left" })
                  .run()
              }
            >
              Signature left
            </button>
            <button
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes("signature", { align: "right" })
                  .run()
              }
            >
              Signature right
            </button>
            <button
              onClick={() => editor.chain().focus().deleteSelection().run()}
            >
              Remove signature
            </button>
          </>
        )}
        <select
          aria-label="Document zoom"
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        >
          {[75, 90, 100, 110, 125, 150].map((value) => (
            <option key={value} value={value}>
              {value}%
            </option>
          ))}
        </select>
      </div>
      <div className="document-workarea">
        <div className="document-scroll">
          <div className="document-ruler" aria-hidden="true">
            <span>0</span>
            <span>2</span>
            <span>4</span>
            <span>6</span>
            <span>8</span>
            <span>10</span>
            <span>12</span>
            <span>14</span>
            <span>16</span>
          </div>
          <div className="document-sheet prescription-sheet" lang={draft.language || "en"} style={{ zoom: zoom / 100 }}>
            {!draft.synthetic && draft.clinician.clinic === practice.name && <Letterhead />}
            <EditorContent editor={editor} />
            <div className="prescription-draft-note">{draft.synthetic ? "FICTIONAL EXAMPLE · NOT FOR PATIENT USE" : "Draft · prescriber review required"}</div>
          </div>
        </div>
        {toolsOpen && (
          <aside className="document-tools" aria-label="Prescription tools">
            <div className="tools-tabs">
              {[
                ["medicines", "Drugs"],
                ["assistant", "AI"],
                ["speech", "Listen"],
                ["dictation", "Dictate"],
                ["signature", "Sign"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={tool === id ? "active" : ""}
                  onClick={() => setTool(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={`tools-content ${tool === "dictation" ? "dictation-content" : ""}`}>
              {tool === "medicines" && (
                <>
                  <h3>Medicine library</h3>
                  <p className="helper">
                    {count === null
                      ? "Loading catalog…"
                      : `${count.toLocaleString()} products from your drug files`}
                  </p>
                  <input
                    aria-label="Search medicine library"
                    placeholder="Brand, generic or strength…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <button
                    className="button full"
                    onClick={() => insertMedicine()}
                  >
                    Add a medicine manually
                  </button>
                  {error && <p className="error">{error}</p>}
                  <div className="editor-drug-results">
                    {products.map((product) => (
                      <button
                        key={product.id}
                        onClick={() => insertMedicine(product)}
                      >
                        <strong>
                          {product.name} · {product.strength}
                        </strong>
                        <span>
                          {product.generic} · {product.form}
                        </span>
                        <small>{product.manufacturer}</small>
                        <span className="text-link">
                          Insert into document ↗
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="helper">
                    Product identity is added to the Rx column. Write the dose
                    and instructions directly in the document.
                  </p>
                  <button className="text-link" onClick={onDevices}>
                    Open live patient observations →
                  </button>
                </>
              )}
              {tool === "assistant" && (
                <Assistant
                  draft={draft}
                  navigate={() => {}}
                  onInsert={(text) =>
                    insertBlocks(
                      text.split("\n").map((line) => ({
                        type: "paragraph",
                        content: line ? [{ type: "text", text: line }] : [],
                      })),
                    )
                  }
                />
              )}
              {tool === "speech" && (
                <SpeechTool
                  key={draft.language || "en"}
                  language={draft.language || "en"}
                  text={documentText(editor.getJSON() as DocumentNode)}
                />
              )}
              {tool === "dictation" && (
                <DictationTool key={draft.id + (draft.language || "en")}
                  initialLanguage={draft.language === "bn" ? "bn-BD" : "en-US"}
                  targets={state?.dictationTargets || []}
                  onInsert={(text, target, action) => applyDictation(editor, target, text, action)} />
              )}
              {tool === "signature" && (
                <SignatureTool
                  disabled={!draft.clinician.name.trim()}
                  onPlace={(src) =>
                    editor.chain().focus().insertContentAt(sectionPosition("footer"), [
                      {
                        type: "signature",
                        attrs: {
                          src,
                          signer: draft.clinician.name,
                          registration: draft.clinician.registration,
                          placedAt: new Date().toISOString(),
                          width: 180,
                          align: "right",
                        },
                      },
                      { type: "paragraph" },
                    ]).run()
                  }
                />
              )}
            </div>
          </aside>
        )}
      </div>
      <div className="document-statusbar">
        <span>
          {
            documentText(editor.getJSON() as DocumentNode)
              .split(/\s+/)
              .filter(Boolean).length
          }{" "}
          words · Ctrl+S saves · Ctrl+Z undoes
        </span>
        <span>{storageError || "Local draft · exact authored text"}</span>
      </div>
    </section>
  );
}
