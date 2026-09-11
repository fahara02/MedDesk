import type { ConsultationInput } from "../lib/clinic";

export function PrescriptionPaper({
  draft,
  large = false,
}: {
  draft: ConsultationInput;
  large?: boolean;
}) {
  const sections = [
    ["complaints", "Presenting complaints"],
    ["history", "Clinical history"],
    ["allergies", "Allergies & reactions"],
    ["examination", "Examination"],
    ["assessment", "Assessment"],
    ["investigations", "Investigations"],
    ["advice", "Advice"],
    ["nutrition", "Diet & nutrition"],
    ["followUp", "Follow-up"],
  ] as const;
  return (
    <article
      className={`prescription-paper ${large ? "large" : ""}`}
      aria-label="Prescription preview"
    >
      <div className="paper-brand">
        <span className="paper-cross">✚</span>
        <div>
          <strong>{draft.clinician.clinic || "Your clinic"}</strong>
          <span>Consultation & prescription</span>
        </div>
        <span className="paper-draft">UNSIGNED DRAFT</span>
      </div>
      <div className="paper-doctor">
        <strong>{draft.clinician.name || "Prescriber name"}</strong>
        <span>
          {draft.clinician.registration
            ? `Registration: ${draft.clinician.registration}`
            : "Registration not recorded"}
        </span>
      </div>
      {draft.synthetic && (
        <div className="paper-synthetic">
          FICTIONAL EXAMPLE · NOT FOR PATIENT USE
        </div>
      )}
      <div className="paper-patient">
        <div>
          <small>PATIENT</small>
          <strong>{draft.patient.name || "Patient name"}</strong>
          <span>
            {[draft.patient.age, draft.patient.sex]
              .filter(Boolean)
              .join(" · ") || "Age / sex not recorded"}
          </span>
          {draft.patient.reference && (
            <span>ID: {draft.patient.reference}</span>
          )}
        </div>
        <div>
          <small>DATE</small>
          <strong>{draft.date}</strong>
          <span>Revision {draft.revision || "—"}</span>
        </div>
      </div>
      {Object.values(draft.manualVitals).some(Boolean) && (
        <div className="paper-vitals">
          <small>MANUALLY RECORDED</small>
          {Object.entries(draft.manualVitals)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <span key={k}>
                {
                  (
                    {
                      bloodPressure: "BP",
                      pulse: "Pulse",
                      temperature: "Temperature",
                      weight: "Weight",
                      spo2: "SpO₂",
                    } as Record<string, string>
                  )[k]
                }
                : {v}
              </span>
            ))}
        </div>
      )}
      <div className="paper-content">
        {sections
          .slice(0, 5)
          .filter(([key]) => draft[key])
          .map(([key, label]) => (
            <section key={key}>
              <h4>{label}</h4>
              <p>{draft[key]}</p>
            </section>
          ))}
        <div className="rx-mark">
          ℞ <span>Prescription</span>
        </div>
        {draft.medications.length ? (
          <ol className="paper-medicines">
            {draft.medications.map((m) => (
              <li key={m.id}>
                <strong>
                  {[m.name || "Medicine not entered", m.strength, m.form]
                    .filter(Boolean)
                    .join(" · ")}
                </strong>
                {m.generic && <small>{m.generic}</small>}
                <p>
                  {[
                    m.dose && `Dose: ${m.dose}`,
                    m.route && `Route: ${m.route}`,
                    m.frequency,
                    m.duration && `For ${m.duration}`,
                    m.quantity && `Quantity: ${m.quantity}`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Instructions not recorded"}
                </p>
                {m.instructions && <p>{m.instructions}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="paper-placeholder">
            Medicines will appear here as you write.
          </p>
        )}
        {sections
          .slice(5)
          .filter(([key]) => draft[key])
          .map(([key, label]) => (
            <section key={key}>
              <h4>{label}</h4>
              <p>{draft[key]}</p>
            </section>
          ))}
      </div>
      <div className="paper-signature">
        <span />
        <small>Prescriber review & signature</small>
      </div>
      <footer>
        <span>Created with MedDesk</span>
        <span>Draft · no digital signature</span>
      </footer>
    </article>
  );
}
