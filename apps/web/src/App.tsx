import { useEffect, useRef, useState } from "react";
import {
  api,
  blankMedication,
  clinicalSections,
  download,
  exampleConsultation,
  importDraft,
  newConsultation,
  parseConsultation,
  reviewIssues,
  serializeDraft,
  type Capabilities,
  type Consultation,
  type ConsultationInput,
  type ConsultationSummary,
  type Medicine,
} from "./lib/clinic";
import { useBand } from "./lib/useBand";
import { Icon } from "./components/Icon";
import { practice } from "./lib/branding";
import { Badge, Modal } from "./components/ui";
import { PrescriptionPaper } from "./components/PrescriptionPaper";
import { MedicineLibrary } from "./components/MedicineLibrary";
import { Studio } from "./components/DocumentStudio";
import { appendMedicine, syncDocumentFields } from "./lib/document";
import { Settings } from "./components/Settings";
import { DesktopBridges } from "./components/DesktopBridges";
import { Assistant } from "./components/Assistant";
import {
  EvidenceWorkspace,
  HistoryWorkspace,
  ImportWorkspace,
  PharmacyWorkspace,
  ReaderWorkspace,
  ShowcaseWorkspace,
  VitalsWorkspace,
} from "./components/WorkspacePages";

const navigation = [
  ["studio", "Prescription studio", "studio"],
  ["import", "Import & review", "import"],
  ["medicine", "Medicine library", "medicine"],
  ["reader", "Patient reader", "reader"],
  ["history", "Patient records", "history"],
  ["vitals", "Vitals & devices", "vitals"],
  ["pharmacy", "Pharmacy", "pharmacy"],
  ["evidence", "Evidence & trust", "evidence"],
  ["showcase", "Product showcase", "showcase"],
] as const;
const STORAGE = "meddesk.workspace.v1";
const draftKey = (draft: ConsultationInput) =>
  JSON.stringify(parseConsultation(draft, true) ?? draft);
function recoverDraft() {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw)
      return parseConsultation(JSON.parse(raw), true) ?? newConsultation();
  } catch {}
  return newConsultation();
}

export default function App({ onLogout }: { onLogout?: () => void } = {}) {
  const [draft, setDraft] = useState<ConsultationInput>(recoverDraft),
    [page, setPage] = useState(() =>
      window.location.hash === "#vitals" ? "vitals" : "studio",
    ),
    [mobile, setMobile] = useState(false);
  const [role, setRole] = useState("doctor");
  const [caps, setCaps] = useState<Capabilities | null>(null),
    [records, setRecords] = useState<ConsultationSummary[]>([]);
  const [notice, setNotice] = useState(""),
    [storageError, setStorageError] = useState(""),
    [recordError, setRecordError] = useState("");
  const [saving, setSaving] = useState(false),
    [lastSaved, setLastSaved] = useState("");
  const [modal, setModal] = useState<
      "medicine" | "review" | "command" | "replace" | "bridge" | null
    >(null),
    [command, setCommand] = useState("");
  const [pending, setPending] = useState<ConsultationInput | null>(null),
    [assistantOpen, setAssistantOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    noticeTimer = useRef<number | undefined>(undefined),
    savingRef = useRef(false),
    saveRef = useRef<() => void>(() => {});
  const band = useBand(),
    hasContent = Boolean(
      draft.patient.name ||
        draft.document ||
        draft.patient.age ||
        draft.patient.sex ||
        draft.patient.reference ||
        draft.medications.length ||
        draft.vitalReadingIds.length ||
        draft.sources.length ||
        clinicalSections.some(([key]) => draft[key]) ||
        Object.values(draft.manualVitals).some(Boolean) ||
        draft.clinician.registration ||
        (draft.clinician.name && draft.clinician.name !== practice.clinician) ||
        (draft.clinician.clinic && draft.clinician.clinic !== practice.name),
    ),
    dirty = draftKey(draft) !== lastSaved && (lastSaved !== "" || hasContent),
    issues = reviewIssues(draft);
  const updateDraft = (next: ConsultationInput) =>
    setDraft((previous) => syncDocumentFields(previous, next));
  const title =
    page === "settings"
      ? "Workspace settings"
      : page === "assistant"
        ? "Clinical assistant"
        : navigation.find(([id]) => id === page)?.[1] || "Prescription studio";
  function notify(text: string) {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 6000);
  }
  async function refresh() {
    try {
      const r = await api<{ consultations: ConsultationSummary[] }>(
        "/api/consultations",
      );
      setRecords(r.consultations);
      setRecordError("");
    } catch (e) {
      setRecordError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    void api<Capabilities>("/api/capabilities")
      .then(setCaps)
      .catch(() => {});
    return () => clearTimeout(noticeTimer.current);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(draft));
        setStorageError("");
      } catch {
        setStorageError(
          "Browser recovery is unavailable. Save this consultation or download a draft to keep your work.",
        );
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      try { localStorage.setItem(STORAGE, JSON.stringify(draft)); } catch {}
    };
  }, [draft]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommand("");
        setModal("command");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  async function save() {
    if (savingRef.current) return false;
    if (!draft.patient.name.trim()) {
      notify("Enter the patient’s name before saving.");
      setPage("studio");
      window.setTimeout(
        () => document.getElementById("patient-name")?.focus(),
        0,
      );
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    const submitted = draft;
    try {
      const r = await api<{ consultation: Consultation }>(
        `/api/consultations/${submitted.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submitted),
        },
      );
      const clean = parseConsultation(r.consultation)!;
      setLastSaved(draftKey(clean));
      setDraft((current) =>
        current.id === submitted.id
          ? { ...current, revision: clean.revision }
          : current,
      );
      notify("Consultation saved on this computer.");
      void refresh();
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  saveRef.current = () => {
    void save();
  };
  const navigate = (value: string) => {
    setPage(value);
    setMobile(false);
    setModal(null);
  };
  function replace(next: ConsultationInput) {
    if (dirty) {
      setPending(next);
      setModal("replace");
    } else {
      setDraft(next);
      setLastSaved(next.revision ? draftKey(next) : "");
      navigate("studio");
    }
  }
  const makeNew = () => {
    const next = newConsultation();
    next.clinician = { ...draft.clinician };
    replace(next);
  };
  const open = async (id: string) => {
    try {
      const r = await api<{ consultation: Consultation }>(
        `/api/consultations/${id}`,
      );
      replace(parseConsultation(r.consultation)!);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const addMedicine = (product: Medicine) => {
    if (draft.medications.length >= 40) {
      notify("This draft has reached the 40-medicine limit.");
      return;
    }
    const medicine = {
      ...blankMedication(),
      catalogId: product.id,
      name: product.name,
      generic: product.generic,
      strength: product.strength,
      form: product.form,
    };
    setDraft((d) => appendMedicine(d, medicine));
    navigate("studio");
    notify("Product added. Enter the authored dose and instructions.");
  };
  const exportDraft = () => {
    download(`meddesk-${draft.date}.json`, serializeDraft(draft));
    notify("MedDesk draft downloaded. This is a JSON workspace file.");
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024)
        throw new Error("Draft imports must be smaller than 1 MB.");
      replace(importDraft(JSON.parse(await file.text())));
      notify(
        "Imported as a new draft. Source files and device readings must be linked locally.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const assistantNavigation = (value: string) => {
    navigate(value);
    setAssistantOpen(false);
  };
  return (
    <div className={`app-shell ${page === "studio" ? "studio-expanded" : ""}`}>
      <a href="#workspace" className="skip-link">
        Skip to workspace
      </a>
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("studio");
          }}
        >
          <span className="brand-logo">m<span>+</span></span>
          <span>meddesk<span className="brand-sub">CLINICAL WORKSPACE</span></span>
        </a>
        <button
          className="practice-switch"
          onClick={() => navigate("settings")}
        >
          <span className="practice-icon">
            <Icon name="pharmacy" size={18} />
          </span>
          <span>
            <strong>{draft.clinician.clinic || "My practice"}</strong>
            <small>Prescription workspace</small>
          </span>
          <Icon name="down" size={15} />
        </button>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {navigation.map(([id, label, icon]) => (
            <button
              key={id}
              aria-label={label}
              title={label}
              aria-current={page === id ? "page" : undefined}
              className={page === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon name={icon} size={19} />
              <span>{label}</span>
              {id === "studio" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="assistant-launch"
            aria-label="Clinical assistant"
            onClick={() => setAssistantOpen(true)}
          >
            <Icon name="spark" />
            <span>Clinical assistant</span>
            <kbd>AI</kbd>
          </button>
          <button
            className={`settings-link ${page === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Icon name="settings" size={18} />
            Settings
          </button>
          <div className="workspace-profile">
            <span className="avatar">
              {draft.clinician.name
                ? draft.clinician.name.slice(0, 1).toUpperCase()
                : "MD"}
            </span>
            <span>
              <strong>{draft.clinician.name || "Your workspace"}</strong>
              <small>
                {draft.clinician.registration ||
                  "Set up your prescriber profile"}
              </small>
            </span>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(!mobile)}
            >
              <Icon name="menu" />
            </button>
            <span>Workspace</span>
            <Icon name="chevron" size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <button className="button small bridge-install-trigger" onClick={() => setModal("bridge")}><Icon name="bluetooth" size={17} />Install Mi Band runner</button>
            {onLogout && <button className="sign-out-button" onClick={onLogout}>Sign out</button>}
            <select
              className="role-switch"
              aria-label="Demonstration workspace"
              title="Changes the view; does not grant clinical authority"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                navigate(
                  e.target.value === "doctor"
                    ? "studio"
                    : e.target.value === "patient"
                      ? "reader"
                      : "pharmacy",
                );
              }}
            >
              <option value="doctor">Doctor view</option>
              <option value="patient">Patient view</option>
              <option value="pharmacy">Pharmacy view</option>
            </select>
            <button
              className="command-trigger"
              onClick={() => {
                setCommand("");
                setModal("command");
              }}
            >
              <Icon name="search" size={16} />
              <span>Quick actions</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className={`server-status ${band.online ? "online" : ""}`}>
              <i />
              {band.online ? "Server online" : "Server unavailable"}
            </span>
            <button
              className="icon-button"
              aria-label="Open workspace settings"
              onClick={() => navigate("settings")}
            >
              <Icon name="user" />
            </button>
          </div>
        </header>
        <main id="workspace" className={`workspace page-${page}`} tabIndex={-1}>
          {storageError && (
            <div className="error" role="alert">
              {storageError}
            </div>
          )}
          {draft.synthetic && (
            <div className="example-banner">
              <span>
                <Icon name="info" size={16} />
                Fictional example · not for patient use
              </span>
              <button onClick={makeNew}>
                Start a real consultation <Icon name="arrow" size={15} />
              </button>
            </div>
          )}
          {page === "studio" && (
            <Studio
              draft={draft}
              update={updateDraft}
              onNew={makeNew}
              onFindPatient={() => navigate("history")}
              onFindMedicine={() => setModal("medicine")}
              onDevices={() => navigate("vitals")}
              onAssistant={() => setAssistantOpen(true)}
              onExport={exportDraft}
              onReview={() => setModal("review")}
              onSave={() => void save()}
              saving={saving}
              dirty={dirty}
              storageError={storageError}
            />
          )}
          {page === "medicine" && (
            <>
              <div className="page-intro">
                <div>
                  <Badge tone="blue">MEDICINE LIBRARY</Badge>
                  <h1>The right product. The source in view.</h1>
                  <p>
                    Search local medicine information without filling in
                    clinical decisions.
                  </p>
                </div>
                <Badge>{caps?.medicineCatalog.files ?? 0} source files</Badge>
              </div>
              <section className="panel">
                <MedicineLibrary
                  count={caps?.medicineCatalog.count}
                  onSelect={addMedicine}
                />
              </section>
            </>
          )}
          <div hidden={page !== "import"}>
            <ImportWorkspace
              draft={draft}
              onChange={updateDraft}
              notify={notify}
            />
          </div>
          {page === "reader" && <ReaderWorkspace draft={draft} />}
          {page === "history" && (
            <>
              {recordError && (
                <p className="error" role="alert">
                  {recordError}
                </p>
              )}
              <HistoryWorkspace
                items={records}
                onOpen={(id) => void open(id)}
                onNewVisit={(record) => {
                  const next = newConsultation();
                  next.patient = { ...record.patient };
                  next.synthetic = record.synthetic;
                  next.clinician = { ...draft.clinician };
                  replace(next);
                }}
                refresh={() => void refresh()}
              />
            </>
          )}
          {page === "vitals" && (
            <VitalsWorkspace
              band={band}
              draft={draft}
              onAttach={(ids) => {
                setDraft({
                  ...draft,
                  vitalReadingIds: [
                    ...new Set([...draft.vitalReadingIds, ...ids]),
                  ],
                });
                notify(
                  "Measurement linked to this patient. Save the consultation to retain it.",
                );
              }}
            />
          )}
          {page === "evidence" && (
            <EvidenceWorkspace draft={draft} capabilities={caps} />
          )}
          {page === "pharmacy" && <PharmacyWorkspace draft={draft} />}
          {page === "showcase" && <ShowcaseWorkspace navigate={navigate} />}
          {page === "assistant" && (
            <div className="assistant-page panel">
              <Assistant draft={draft} navigate={assistantNavigation} />
            </div>
          )}
          {page === "settings" && (
            <Settings
              draft={draft}
              update={updateDraft}
              capabilities={caps}
              navigate={navigate}
              onImport={() => fileInput.current?.click()}
              onExport={exportDraft}
              onExample={() => replace(exampleConsultation())}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>
            MedDesk <span>·</span> A clearer path through care
          </span>
          <span>
            Local workspace <span>·</span> Unsigned drafts
          </span>
        </footer>
      </div>
      <input
        ref={fileInput}
        hidden
        type="file"
        accept=".json"
        onChange={(e) => void readFile(e.target.files?.[0])}
      />
      {notice && (
        <div className="toast" role="status">
          <Icon name="info" size={18} />
          <span>{notice}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {assistantOpen && (
        <Modal
          title="Clinical assistant"
          onClose={() => setAssistantOpen(false)}
        >
          <div className="assistant-content">
            <Assistant draft={draft} navigate={assistantNavigation} />
          </div>
        </Modal>
      )}
      {modal === "bridge" && <Modal title="Install Mi Band runner" onClose={() => setModal(null)}><DesktopBridges band={band} /></Modal>}
      {modal === "medicine" && (
        <Modal title="Find a medicine" wide onClose={() => setModal(null)}>
          <MedicineLibrary
            count={caps?.medicineCatalog.count}
            onSelect={addMedicine}
          />
        </Modal>
      )}
      {modal === "review" && (
        <Modal
          title="Review the prescription"
          wide
          onClose={() => setModal(null)}
        >
          <div className="review-grid">
            <div>
              <Badge tone="amber">Unsigned draft</Badge>
              <h3>{issues.length} authoring items to review</h3>
              {issues.length ? (
                <ul className="review-issues">
                  {issues.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  Required authoring fields are present. Clinical correctness
                  has not been automatically checked.
                </p>
              )}
              <p className="helper">
                Printing produces a draft with no digital signature. Review all
                patient details, medicine names, doses and instructions.
              </p>
              <button
                className="button primary"
                disabled={!draft.patient.name.trim()}
                onClick={() => {
                  setModal(null);
                  window.setTimeout(() => window.print(), 100);
                }}
              >
                <Icon name="print" size={17} />
                Print unsigned draft
              </button>
            </div>
            <PrescriptionPaper draft={draft} />
          </div>
        </Modal>
      )}
      {modal === "command" && (
        <Modal title="Quick actions" onClose={() => setModal(null)}>
          <div className="command-menu">
            <div className="search-box">
              <Icon name="search" />
              <input
                aria-label="Search quick actions"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Where would you like to go?"
              />
            </div>
            {[
              ...navigation,
              ["assistant", "Clinical assistant", "spark"],
              ["settings", "Workspace settings", "settings"],
            ]
              .filter(([, label]) =>
                label.toLowerCase().includes(command.toLowerCase()),
              )
              .map(([id, label, icon]) => (
                <button key={id} onClick={() => navigate(id)}>
                  <Icon name={icon} />
                  {label}
                  <Icon name="arrow" size={16} />
                </button>
              ))}
            <button onClick={makeNew}>
              <Icon name="plus" />
              New consultation<kbd>New</kbd>
            </button>
          </div>
        </Modal>
      )}
      {modal === "replace" && (
        <Modal
          title="Keep the current draft?"
          onClose={() => {
            setPending(null);
            setModal(null);
          }}
        >
          <div className="panel-body">
            <p>
              The current consultation has unsaved changes. Download it first,
              or replace the active workspace.
            </p>
            <div className="toolbar">
              <button className="button" onClick={exportDraft}>
                Download current draft
              </button>
              <button
                className="button"
                onClick={() => {
                  setPending(null);
                  setModal(null);
                }}
              >
                Keep editing
              </button>
              <button
                className="button primary"
                onClick={() => {
                  if (pending) {
                    setDraft(pending);
                    setLastSaved(pending.revision ? draftKey(pending) : "");
                    setPending(null);
                    navigate("studio");
                  }
                }}
              >
                Replace workspace
              </button>
            </div>
          </div>
        </Modal>
      )}
      <div className="print-only">
        <PrescriptionPaper draft={draft} large />
      </div>
    </div>
  );
}
