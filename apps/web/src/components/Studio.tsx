import { useState, type CSSProperties } from "react";
import type { ConsultationInput, MedicationOrder } from "../lib/clinic";
import { clinicalSections, blankMedication } from "../lib/clinic";
import { Icon } from "./Icon";
import { Badge, Empty, Field } from "./ui";
import { PrescriptionPaper } from "./PrescriptionPaper";

export function Studio({
  draft,
  update,
  onNew,
  onFindPatient,
  onFindMedicine,
  onDevices,
  onAssistant,
  onExport,
  onReview,
  onSave,
  saving,
  dirty,
  storageError,
}: {
  draft: ConsultationInput;
  update: (d: ConsultationInput) => void;
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
  const [section, setSection] = useState("Prescription"),
    [layout, setLayout] = useState("edit");
  const [split, setSplit] = useState(54);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const change = (id: string, field: keyof MedicationOrder, value: string) =>
    update({
      ...draft,
      medications: draft.medications.map((m) =>
        m.id === id ? { ...m, [field]: value } : m,
      ),
    });
  const move = (index: number, delta: number) => {
    const items = [...draft.medications],
      next = index + delta;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]];
    update({ ...draft, medications: items });
  };
  return (
    <>
      <div className="page-intro studio-intro">
        <div>
          <div className="intro-overline">
            <span className="eyebrow">CARE, WITH CLARITY</span>
            <Badge tone="blue">Outpatient consultation</Badge>
          </div>
          <h1>Good care starts with a clear record.</h1>
          <p>Write with confidence. Keep the patient at the center.</p>
        </div>
        <button className="button" disabled={saving} onClick={onNew}>
          <Icon name="plus" size={17} />
          New consultation
        </button>
      </div>
      <section className="patient-strip panel">
        <div className="patient-strip-heading">
          <span className="avatar large">
            <Icon name="user" size={25} />
          </span>
          <div>
            <strong>Patient details</strong>
            <small>For this consultation</small>
          </div>
          <button className="text-link" onClick={onFindPatient}>
            Find patient <Icon name="search" size={13} />
          </button>
        </div>
        <div className="patient-fields">
          <Field label="Patient name">
            <input
              id="patient-name"
              maxLength={160}
              value={draft.patient.name}
              onChange={(e) =>
                update({
                  ...draft,
                  patient: { ...draft.patient, name: e.target.value },
                })
              }
              placeholder="Enter full name"
            />
          </Field>
          <Field label="Age">
            <input
              maxLength={40}
              value={draft.patient.age}
              onChange={(e) =>
                update({
                  ...draft,
                  patient: { ...draft.patient, age: e.target.value },
                })
              }
              placeholder="e.g. 32 years"
            />
          </Field>
          <Field label="Sex">
            <select
              value={draft.patient.sex}
              onChange={(e) =>
                update({
                  ...draft,
                  patient: { ...draft.patient, sex: e.target.value },
                })
              }
            >
              <option value="">Not recorded</option>
              <option>Female</option>
              <option>Male</option>
              <option>Other</option>
            </select>
          </Field>
          <Field label="Patient reference">
            <input
              maxLength={100}
              value={draft.patient.reference}
              onChange={(e) =>
                update({
                  ...draft,
                  patient: { ...draft.patient, reference: e.target.value },
                })
              }
              placeholder="Hospital / patient ID"
            />
          </Field>
          <Field label="Visit date">
            <input
              type="date"
              value={draft.date}
              onChange={(e) => update({ ...draft, date: e.target.value })}
            />
          </Field>
        </div>
      </section>
      <div className="mobile-editor-switch">
        <button
          className={layout === "edit" ? "active" : ""}
          onClick={() => setLayout("edit")}
        >
          Edit consultation
        </button>
        <button
          className={layout === "preview" ? "active" : ""}
          onClick={() => setLayout("preview")}
        >
          Prescription preview
        </button>
      </div>
      <label className="split-control">
        Editor width{" "}
        <input
          type="range"
          aria-label="Editor width"
          min={42}
          max={62}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
        />
        <output>{split}%</output>
      </label>
      <div
        className={`studio-grid mode-${layout}`}
        style={
          {
            "--editor-width": `${split}fr`,
            "--preview-width": `${100 - split}fr`,
          } as CSSProperties
        }
      >
        <section className="editor-column">
          <div className="panel editor-panel">
            <div className="editor-tabs">
              {["Prescription", "Clinical notes", "Observations"].map((tab) => (
                <button
                  key={tab}
                  className={section === tab ? "active" : ""}
                  onClick={() => setSection(tab)}
                >
                  {tab}
                  {tab === "Prescription" && (
                    <span>{draft.medications.length}</span>
                  )}
                </button>
              ))}
            </div>
            {section === "Prescription" && (
              <div className="panel-body">
                <div className="section-heading">
                  <div>
                    <h2>Medication orders</h2>
                    <p>Exact doses. Clear instructions.</p>
                  </div>
                  <button className="button small" onClick={onFindMedicine}>
                    <Icon name="search" size={15} />
                    Find medicine
                  </button>
                </div>
                {draft.medications.map((m, index) => (
                  <article className="medication-card" key={m.id}>
                    <header>
                      <span className="number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <strong>{m.name || "New medicine"}</strong>
                        <small>{m.generic || "Authored medicine order"}</small>
                      </div>
                      <button
                        className="icon-button small"
                        aria-label={`${collapsed.has(m.id) ? "Expand" : "Collapse"} medicine ${index + 1}`}
                        aria-expanded={!collapsed.has(m.id)}
                        onClick={() =>
                          setCollapsed((previous) => {
                            const next = new Set(previous);
                            if (next.has(m.id)) next.delete(m.id);
                            else next.add(m.id);
                            return next;
                          })
                        }
                      >
                        <Icon
                          name={collapsed.has(m.id) ? "chevron" : "down"}
                          size={16}
                        />
                      </button>
                      <button
                        className="icon-button small"
                        aria-label={`Move medicine ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="icon-button small"
                        aria-label={`Move medicine ${index + 1} down`}
                        disabled={index === draft.medications.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="icon-button small"
                        aria-label={`Remove medicine ${index + 1}`}
                        onClick={() =>
                          update({
                            ...draft,
                            medications: draft.medications.filter(
                              (item) => item.id !== m.id,
                            ),
                          })
                        }
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </header>
                    <div
                      className="medication-fields"
                      hidden={collapsed.has(m.id)}
                    >
                      <Field label="Medicine name">
                        <input
                          maxLength={300}
                          value={m.name}
                          onChange={(e) => change(m.id, "name", e.target.value)}
                          placeholder="Brand or generic name"
                        />
                      </Field>
                      <div className="field-pair">
                        <Field label="Strength">
                          <input
                            value={m.strength}
                            maxLength={300}
                            onChange={(e) =>
                              change(m.id, "strength", e.target.value)
                            }
                            placeholder="As authored"
                          />
                        </Field>
                        <Field label="Form">
                          <input
                            value={m.form}
                            maxLength={300}
                            onChange={(e) =>
                              change(m.id, "form", e.target.value)
                            }
                            placeholder="Tablet, solution…"
                          />
                        </Field>
                      </div>
                      <div className="field-pair">
                        <Field label="Dose">
                          <input
                            value={m.dose}
                            maxLength={300}
                            onChange={(e) =>
                              change(m.id, "dose", e.target.value)
                            }
                            placeholder="Exact amount + unit"
                          />
                        </Field>
                        <Field label="Route">
                          <input
                            value={m.route}
                            maxLength={300}
                            onChange={(e) =>
                              change(m.id, "route", e.target.value)
                            }
                            placeholder="Enter route"
                          />
                        </Field>
                      </div>
                      <div className="field-triple">
                        <Field label="Frequency">
                          <input
                            value={m.frequency}
                            maxLength={300}
                            onChange={(e) =>
                              change(m.id, "frequency", e.target.value)
                            }
                            placeholder="Written schedule"
                          />
                        </Field>
                        <Field label="Duration">
                          <input
                            value={m.duration}
                            maxLength={300}
                            onChange={(e) =>
                              change(m.id, "duration", e.target.value)
                            }
                            placeholder="Written duration"
                          />
                        </Field>
                        <Field label="Quantity">
                          <input
                            value={m.quantity}
                            maxLength={300}
                            onChange={(e) =>
                              change(m.id, "quantity", e.target.value)
                            }
                            placeholder="Amount + unit"
                          />
                        </Field>
                      </div>
                      <Field label="Additional instructions">
                        <input
                          value={m.instructions}
                          maxLength={2000}
                          onChange={(e) =>
                            change(m.id, "instructions", e.target.value)
                          }
                          placeholder="Conditions, timing or patient instructions"
                        />
                      </Field>
                    </div>
                  </article>
                ))}
                {!draft.medications.length && (
                  <Empty
                    icon="medicine"
                    title="Write the first medicine"
                    action={
                      <button
                        className="button primary"
                        onClick={onFindMedicine}
                      >
                        <Icon name="search" size={16} />
                        Search medicine library
                      </button>
                    }
                  >
                    Choose the exact product from your library, or start with a
                    blank order.
                  </Empty>
                )}
                <button
                  className="add-order"
                  disabled={draft.medications.length >= 40}
                  onClick={() =>
                    update({
                      ...draft,
                      medications: [...draft.medications, blankMedication()],
                    })
                  }
                >
                  <Icon name="plus" size={18} />
                  Add a medicine manually
                </button>
                <div className="section-divider" />
                <Field label="Advice & follow-up care">
                  <textarea
                    rows={3}
                    maxLength={8000}
                    value={draft.advice}
                    onChange={(e) =>
                      update({ ...draft, advice: e.target.value })
                    }
                    placeholder="Write clear instructions for the patient…"
                  />
                </Field>
                <Field label="Next review">
                  <input
                    maxLength={8000}
                    value={draft.followUp}
                    onChange={(e) =>
                      update({ ...draft, followUp: e.target.value })
                    }
                    placeholder="Follow-up date or conditions, as authored"
                  />
                </Field>
              </div>
            )}
            {section === "Clinical notes" && (
              <div className="panel-body">
                <div className="section-heading">
                  <div>
                    <h2>The clinical picture</h2>
                    <p>Document what is known. Leave the rest open.</p>
                  </div>
                  <Icon name="file" />
                </div>
                {clinicalSections
                  .filter(([key]) => key !== "advice" && key !== "followUp")
                  .map(([key, label]) => (
                    <Field label={label} key={key}>
                      <textarea
                        rows={key === "history" ? 4 : 3}
                        maxLength={8000}
                        value={draft[key]}
                        onChange={(e) =>
                          update({ ...draft, [key]: e.target.value })
                        }
                        placeholder={`Enter ${label.toLowerCase()}…`}
                      />
                    </Field>
                  ))}
              </div>
            )}
            {section === "Observations" && (
              <div className="panel-body">
                <div className="section-heading">
                  <div>
                    <h2>Visit observations</h2>
                    <p>Enter the value and unit exactly as measured.</p>
                  </div>
                  <Icon name="vitals" />
                </div>
                <div className="field-pair">
                  {(
                    [
                      [
                        "bloodPressure",
                        "Blood pressure",
                        "e.g. systolic/diastolic mmHg",
                      ],
                      ["pulse", "Pulse", "Value + bpm"],
                      ["temperature", "Temperature", "Value + °C or °F"],
                      ["weight", "Weight", "Value + kg"],
                      ["spo2", "Oxygen saturation", "Value + %"],
                    ] as const
                  ).map(([key, label, placeholder]) => (
                    <Field key={key} label={label}>
                      <input
                        value={draft.manualVitals[key]}
                        maxLength={80}
                        placeholder={placeholder}
                        onChange={(e) =>
                          update({
                            ...draft,
                            manualVitals: {
                              ...draft.manualVitals,
                              [key]: e.target.value,
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
                <div className="device-link-card">
                  <span className="device-illustration">
                    <Icon name="vitals" size={25} />
                  </span>
                  <div>
                    <strong>Connect a wearable</strong>
                    <p>
                      Review real readings before linking them to this patient.
                    </p>
                  </div>
                  <button className="button small" onClick={onDevices}>
                    View devices <Icon name="arrow" size={15} />
                  </button>
                </div>
                {draft.vitalReadingIds.length > 0 && (
                  <div className="notice">
                    <p>
                      {draft.vitalReadingIds.length} band measurements
                      explicitly linked to this visit.
                    </p>
                    <button
                      className="text-link"
                      onClick={() => update({ ...draft, vitalReadingIds: [] })}
                    >
                      Remove linked readings
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <button className="ai-inline" onClick={onAssistant}>
            <span>
              <Icon name="spark" />
              <strong>A second look before you finish</strong>
              <small>Review missing information in this draft</small>
            </span>
            <Icon name="arrow" />
          </button>
        </section>
        <aside className="preview-column">
          <div className="preview-heading">
            <span>
              <span className="live-dot" />
              LIVE PREVIEW
            </span>
            <Icon name="file" size={17} />
          </div>
          <PrescriptionPaper draft={draft} />
          <div className="preview-foot">
            <Icon name="evidence" size={15} />
            <span>Changes appear here as you write.</span>
          </div>
        </aside>
      </div>
      <div className="action-bar">
        <div className="save-status">
          <Icon name={dirty ? "file" : "check"} size={16} />
          <span>
            {saving
              ? "Saving consultation…"
              : !draft.revision && !dirty
                ? "New consultation"
                : !dirty
                  ? "Saved on this computer"
                  : draft.revision
                    ? "Unsaved changes"
                    : "Draft in progress"}
            <small>
              {storageError
                ? "Browser recovery unavailable"
                : "Recovery copy kept on this device"}
            </small>
          </span>
        </div>
        <div className="toolbar">
          <button
            className="button"
            aria-label="Download draft"
            onClick={onExport}
          >
            <Icon name="download" size={17} />
            <span>Download draft</span>
          </button>
          <button
            className="button"
            aria-label="Review and print"
            onClick={onReview}
          >
            <Icon name="print" size={17} />
            <span>Review & print</span>
          </button>
          <button className="button primary" disabled={saving} onClick={onSave}>
            <Icon name="save" size={17} />
            {saving ? "Saving…" : "Save consultation"}
          </button>
        </div>
      </div>
    </>
  );
}
