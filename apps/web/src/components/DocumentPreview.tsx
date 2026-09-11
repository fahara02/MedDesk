import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { documentExtensions } from "./editor-extensions";
import type { DocumentNode } from "../lib/document";
export function DocumentPreview({
  document,
  synthetic = false,
}: {
  document: DocumentNode;
  synthetic?: boolean;
}) {
  const editor = useEditor({
    extensions: documentExtensions(),
    content: document,
    editable: false,
    editorProps: { attributes: { class: "prescription-document" } },
  });
  useEffect(() => {
    editor?.commands.setContent(document, { emitUpdate: false });
  }, [document, editor]);
  return (
    <article className="document-sheet" aria-label="Prescription preview">
      {synthetic && (
        <p className="notice">
          Fictional demonstration — not a prescription for patient use.
        </p>
      )}
      <EditorContent editor={editor} />
    </article>
  );
}
