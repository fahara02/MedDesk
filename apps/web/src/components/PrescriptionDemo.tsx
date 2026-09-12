import { useState } from "react";
import { demoPrescription } from "../../../server/src/demo-prescription";
import { PrescriptionPaper } from "./PrescriptionPaper";
import { Badge } from "./ui";
import { Icon } from "./Icon";
import manifest from "../../public/demo/manifest.json";

export function PrescriptionDemo({ onUse, onOpen }: { onUse: () => void; onOpen: () => void }) {
  const [sample] = useState(demoPrescription);
  return <>
    <div className="page-intro">
      <div><Badge tone="blue">PRESCRIPTION DEMO</Badge><h1>One prescription. Explore the formats.</h1>
        <p>Ayesha Rahman · 32 years · Dhanmondi, Dhaka. A fully populated fictional consultation.</p></div>
      <button className="button primary" onClick={onUse}><Icon name="studio" size={17} />Open editable copy</button>
    </div>
    <div className="demo-disclosure"><Icon name="info" size={18} /><span><strong>Demonstration only.</strong> The patient, prescriber, medicines and observations form a fictional scenario. Not for patient use.</span></div>
    <div className="demo-format-grid">
      <section className="panel demo-format-card">
        <div className="panel-bar"><strong>PDF</strong><Badge tone="green">Ready to download</Badge></div>
        <div className="panel-body"><h2>A page you can share</h2><p>Download the complete, one-page English prescription with selectable text, medicines and clinical notes.</p>
          <a className="button primary" href="/demo/ayesha-rahman-prescription.pdf" download="ayesha-rahman-demo-prescription.pdf"><Icon name="download" size={17} />Save sample as PDF</a>
          <p className="helper">{manifest.pdfBytes.toLocaleString("en-US")} bytes · 1 page. After editing a copy, use Save as PDF in the studio and choose your browser’s Save as PDF destination.</p></div>
      </section>
      <section className="panel demo-format-card">
        <div className="panel-bar"><strong>LPS</strong><Badge tone="blue">Unsigned demo</Badge></div>
        <div className="panel-body"><h2>A prescription you can reopen</h2><p>Save the patient details, medicines, observations and notes together. Reopen the file here to edit them.</p>
          <a className="button primary" href="/demo/ayesha-rahman-prescription.lps" download="ayesha-rahman-demo-prescription.lps"><Icon name="download" size={17} />Save sample as LPS</a>
          <button className="button" onClick={onOpen}>Open an LPS file</button>
          <p className="helper">{manifest.lpsBytes.toLocaleString("en-US")} bytes · editable. Private demo format for MedDesk. Unsigned and not for patient use; compatibility with other LPS readers is not established.</p></div>
      </section>
    </div>
    <section className="panel demo-walkthrough">
      <div><span>1</span><strong>Inspect the filled prescription</strong><p>Patient details, two medicines, examination, advice and follow-up.</p></div>
      <div><span>2</span><strong>Open an editable copy</strong><p>Change a field, dictate a note, save the consultation and reopen it.</p></div>
      <div><span>3</span><strong>Compare the exports</strong><p>PDF keeps the page. Demo LPS keeps the editable prescription. Download both above.</p></div>
    </section>
    <div className="demo-paper-frame"><PrescriptionPaper draft={sample} /></div>
  </>;
}
