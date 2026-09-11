import type { Capabilities, ConsultationInput } from "../lib/clinic";
import { Badge, Field } from "./ui";
import { Icon } from "./Icon";
export function Settings({
  draft,
  update,
  capabilities,
  navigate,
  onImport,
  onExport,
  onExample,
}: {
  draft: ConsultationInput;
  update: (d: ConsultationInput) => void;
  capabilities: Capabilities | null;
  navigate: (p: string) => void;
  onImport: () => void;
  onExport: () => void;
  onExample: () => void;
}) {
  return (
    <>
      <div className="page-intro">
        <div>
          <Badge tone="blue">WORKSPACE SETTINGS</Badge>
          <h1>Make this space your practice.</h1>
          <p>Prescriber details, local data and connected services.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-bar">
            <strong>Prescriber profile</strong>
            <Icon name="user" />
          </div>
          <div className="panel-body">
            {(
              [
                ["name", "Prescriber name"],
                ["registration", "Registration number"],
                ["clinic", "Clinic / practice details"],
                ["qualifications", "Qualifications"],
                ["designation", "Specialty / designation"],
                ["address", "Chamber address"],
                ["phone", "Appointment / contact number"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  maxLength={
                    key === "registration" || key === "phone" ? 100 : key === "name" ? 160 : 400
                  }
                  value={draft.clinician[key] || ""}
                  onChange={(e) =>
                    update({
                      ...draft,
                      clinician: { ...draft.clinician, [key]: e.target.value },
                    })
                  }
                  placeholder={label}
                />
              </Field>
            ))}
            <p className="helper">
              These are authored display details. Identity and prescribing
              authority have not been verified.
            </p>
            <button
              className="button primary"
              onClick={() => navigate("studio")}
            >
              Use in this consultation <Icon name="arrow" size={17} />
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-bar">
            <strong>Connected services</strong>
            <Icon name="settings" />
          </div>
          <div className="service-list">
            {[
              [
                "Local consultation storage",
                capabilities?.consultation ? "Available" : "Unavailable",
              ],
              [
                "Medicine library",
                capabilities
                  ? `${capabilities.medicineCatalog.count.toLocaleString()} imported products`
                  : "Loading…",
              ],
              ["AI provider", "Not configured"],
              ["Native .lps reader / writer", "Not connected"],
              ["OCR / Mojo worker", "Not connected"],
              ["Neural speech", "Not configured"],
              ["Signing & pharmacy events", "Not connected"],
            ].map(([name, status]) => (
              <div key={name}>
                <span>{name}</span>
                <Badge tone={status === "Available" ? "green" : ""}>
                  {status}
                </Badge>
              </div>
            ))}
          </div>
          <div className="panel-body">
            <p className="helper">
              AI needs a chosen provider and API credentials. OCR needs the
              processing worker. These services cannot be enabled by a display
              setting.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-bar">
            <strong>Draft files & recovery</strong>
            <Icon name="file" />
          </div>
          <div className="panel-body">
            <p>
              Consultations are saved by the local server. A recovery copy of
              the active draft is kept in this browser.
            </p>
            <div className="toolbar">
              <button className="button" onClick={onImport}>
                <Icon name="import" size={17} />
                Open draft JSON
              </button>
              <button className="button" onClick={onExport}>
                <Icon name="download" size={17} />
                Download draft
              </button>
            </div>
            <p className="helper">
              MedDesk JSON files are workspace drafts. Native .lps export
              requires the core bridge; it is not included in this build.
            </p>
            <hr />
            <button className="text-link" onClick={onExample}>
              Explore a fictional consultation →
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-bar">
            <strong>About this workspace</strong>
            <Badge tone="blue">Local edition</Badge>
          </div>
          <div className="panel-body">
            <h3>Built around the patient.</h3>
            <p>
              MedDesk brings prescription authoring, source review and device
              observations into one local workspace.
            </p>
            <p className="helper">
              This is a single-user local application. Multi-user access
              control, clinical validation and signed prescribing are separate
              release requirements.
            </p>
            <button className="button" onClick={() => navigate("showcase")}>
              Explore the full product plan <Icon name="arrow" size={17} />
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
