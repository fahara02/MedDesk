import type { ConsultationInput } from "../lib/clinic";
import { initialDocument } from "../lib/document";
import { practice } from "../lib/branding";
import { DocumentPreview } from "./DocumentPreview";

export function PrescriptionPaper({ draft }: { draft: ConsultationInput; large?: boolean }) {
  return <DocumentPreview document={initialDocument(draft)} synthetic={draft.synthetic}
    language={draft.language || "en"} showLetterhead={draft.clinician.clinic === practice.name} />;
}
