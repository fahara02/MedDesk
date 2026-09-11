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
import { Icon } from "./Icon";

export function Studio({
  draft,
  update,
  onNew,
  onFindPatient,
  onDevices,
  onExport,
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
          class: "prescription-document",
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
  }, [draft.document, draft.id, editor]);
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
    let position = editor.state.selection.from;
    const parent = editor.state.selection.$from;
    if (parent.parent.type.name === "recordField") {
      position = parent.after(parent.depth);
      if (
        parent.depth > 1 &&
        parent.node(parent.depth - 1).type.name === "medicationBlock"
      )
        position = parent.after(parent.depth - 1);
    }
    if (editor.state.selection.from <= 1)
      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === "heading" &&
          node.textContent === "℞ Prescription"
        )
          position = pos + node.nodeSize;
      });
    editor
      .chain()
      .focus()
      .insertContentAt(position, [medicineNode(item), { type: "paragraph" }])
      .run();
  };
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
          <div className="document-sheet" style={{ zoom: zoom / 100 }}>
            {!draft.synthetic && <Letterhead />}
            <EditorContent editor={editor} />
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
            <div className="tools-content">
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
                    Product identity is inserted at your cursor. Write the dose
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
                  text={documentText(editor.getJSON() as DocumentNode)}
                />
              )}
              {tool === "dictation" && (
                <DictationTool key={draft.id} onInsert={(text) =>
                  editor.chain().focus().insertContent({ type: "text", text }).run()
                } />
              )}
              {tool === "signature" && (
                <SignatureTool
                  disabled={!draft.clinician.name.trim()}
                  onPlace={(src) =>
                    insertBlocks([
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
                    ])
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
