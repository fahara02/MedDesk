import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { documentExtensions } from "./editor-extensions";
import { formatPrescription, type DocumentNode } from "../lib/document";
import { Letterhead } from "./Letterhead";
export function DocumentPreview({
  document,
  synthetic = false,
  language = "en", showLetterhead = true,
}: {
  document: DocumentNode;
  synthetic?: boolean;
  language?: "en" | "bn"; showLetterhead?: boolean;
}) {
  const editor = useEditor({
    extensions: documentExtensions(),
    content: formatPrescription(document, language),
    editable: false,
    editorProps: { attributes: { class: "prescription-document prescription-pad" } },
  });
  useEffect(() => {
    editor?.commands.setContent(formatPrescription(document, language), { emitUpdate: false });
  }, [document, language, editor]);
  return (
    <article className="document-sheet prescription-sheet" lang={language} aria-label="Prescription preview">
      {!synthetic && showLetterhead && <Letterhead />}
      <EditorContent editor={editor} />
      <div className="prescription-draft-note">{synthetic ? "FICTIONAL EXAMPLE · NOT FOR PATIENT USE" : "Draft · prescriber review required"}</div>
    </article>
  );
}
