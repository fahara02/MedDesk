import { useEffect, useRef, useState } from "react";
import {
  api,
  clinicalSections,
  download,
  reviewIssues,
  serializeDraft,
  type Artifact,
  type Capabilities,
  type Consultation,
  type ConsultationInput,
  type ConsultationSummary,
} from "../lib/clinic";
import type { Reading } from "../types";
import { Icon } from "./Icon";
import { Badge, Empty, Field, Modal } from "./ui";
import { RevisionHistory } from "./RevisionHistory";
import { PrescriptionPaper } from "./PrescriptionPaper";
import type { useBand } from "../lib/useBand";
import coverage from "../content/coverage.json";
import { Sparkline } from "./Sparkline";
import { SleepHistoryPanel } from "./SleepHistoryPanel";
import { DesktopBridges } from "./DesktopBridges";

export function ImportWorkspace({
  draft,
  onChange,
  notify,
}: {
  draft: ConsultationInput;
  onChange: (draft: ConsultationInput) => void;
  notify: (text: string) => void;
}) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [field, setField] =
    useState<(typeof clinicalSections)[number][0]>("complaints");
  const [text, setText] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    setArtifact(null);
    setText("");
    setReviewed(false);
    setZoom(100);
  }, [draft.id]);
  const upload = async (file?: File) => {
    if (!file) return;
    setError("");
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose a PDF, PNG or JPEG up to 10 MB.");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ artifact: Artifact }>("/api/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });
      setArtifact(r.artifact);
      setText("");
      setReviewed(false);
      setZoom(100);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const apply = () => {
    if (!artifact || !reviewed || !text.trim()) return;
    const existing = draft.sources.find((s) => s.artifactId === artifact.id);
    const source = {
      artifactId: artifact.id,
      name: artifact.name,
      fields: [...new Set([...(existing?.fields ?? []), field])],
    };
    onChange({
      ...draft,
      [field]: text,
      sources: [
        ...draft.sources.filter((s) => s.artifactId !== artifact.id),
        source,
      ],
    });
    notify("Reviewed text added to the draft with its source file.");
    setText("");
    setReviewed(false);
  };
  return (
    <>
      <div className="page-intro">
        <div>
          <Badge tone="blue">SOURCE WORKSPACE</Badge>
          <h1>From paper to a clearer record.</h1>
          <p>Keep the original beside every field you transcribe.</p>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Icon name="import" />
          {busy ? "Uploading…" : "Choose source"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        hidden
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="import-grid">
        <section
          className="panel source-canvas"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void upload(e.dataTransfer.files[0]);
          }}
        >
          <div className="panel-bar">
            <strong>{artifact?.name || "Original document"}</strong>
            <Badge>
              {artifact
                ? `${Math.ceil(artifact.size / 1024)} KB`
                : "PDF · PNG · JPG"}
            </Badge>
          </div>
          {artifact ? (
            <div className="document-canvas">
              {artifact.mime === "application/pdf" ? (
                <iframe
                  title="Original source PDF"
                  src={`/api/artifacts/${artifact.id}`}
                />
              ) : (
                <img
                  style={{
                    width: `${zoom}%`,
                    maxWidth: "none",
                    height: "auto",
                    alignSelf: "start",
                  }}
                  alt="Original source document for transcription"
                  src={`/api/artifacts/${artifact.id}`}
                />
              )}
            </div>
          ) : (
            <Empty
              icon="import"
              title="Bring the original into view"
              action={
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  Browse files
                </button>
              }
            >
              Drop a report or prescription here. Original bytes are retained
              locally. Maximum 10 MB.
            </Empty>
          )}
          {artifact && (
            <div className="source-controls">
              {artifact.mime !== "application/pdf" && (
                <label>
                  Zoom{" "}
                  <input
                    aria-label="Source image zoom"
                    type="range"
                    min={50}
                    max={250}
                    step={10}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  />
                  <output>{zoom}%</output>
                </label>
              )}
              <a
                className="text-link"
                href={`/api/artifacts/${artifact.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open original <Icon name="arrow" size={14} />
              </a>
            </div>
          )}
          {artifact && (
            <div className="source-digest">
              <Icon name="evidence" size={16} />
              <span>
                SHA-256 <code>{artifact.id}</code>
              </span>
            </div>
          )}
        </section>
        <section className="panel transcription">
          <div className="panel-bar">
            <strong>Review & transcribe</strong>
            <Badge tone="amber">Human review</Badge>
          </div>
          <div className="panel-body">
            <div className="notice">
              <Icon name="info" />
              <div>
                <strong>Manual transcription is available</strong>
                <p>
                  Automated OCR is not connected. Enter only what you can read
                  in the original.
                </p>
              </div>
            </div>
            <Field label="Destination field">
              <select
                value={field}
                onChange={(e) => {
                  setField(e.target.value as typeof field);
                  setReviewed(false);
                }}
              >
                {clinicalSections.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Exact source text">
              <textarea
                rows={10}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setReviewed(false);
                }}
                placeholder="Transcribe the selected field. Leave uncertain words unresolved."
              />
            </Field>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I checked this text against the source.
            </label>
            {draft[field] && (
              <p className="helper">
                Applying will replace the current{" "}
                {clinicalSections.find(([k]) => k === field)?.[1].toLowerCase()}{" "}
                text.
              </p>
            )}
            <button
              className="button primary full"
              disabled={!artifact || !text.trim() || !reviewed}
              onClick={apply}
            >
              Apply reviewed text <Icon name="arrow" size={17} />
            </button>
            <p className="helper">
              Saved as a local draft with a source-file link. Signed
              transcription and region-level native evidence remain unavailable.
            </p>
          </div>
        </section>
      </div>
      {draft.sources.length > 0 && (
        <section className="panel sources-list">
          <h3>Sources linked to this draft</h3>
          {draft.sources.map((s) => (
            <a
              href={`/api/artifacts/${s.artifactId}`}
              target="_blank"
              rel="noreferrer"
              key={s.artifactId}
            >
              <Icon name="file" />
              <span>
                <strong>{s.name}</strong>
                <small>{s.fields.join(" · ")}</small>
              </span>
              <Icon name="arrow" />
            </a>
          ))}
        </section>
      )}
    </>
  );
}

export function ReaderWorkspace({ draft }: { draft: ConsultationInput }) {
  const [size, setSize] = useState(18),
    [language, setLanguage] = useState("en"),
    [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [playing, setPlaying] = useState<string | null>(null),
    [paused, setPaused] = useState(false),
    [message, setMessage] = useState("");
  const textFor = (m: ConsultationInput["medications"][number]) =>
    [
      m.name,
      m.strength,
      m.dose,
      m.route,
      m.frequency,
      m.duration,
      m.instructions,
    ]
      .filter(Boolean)
      .join(". ");
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const update = () =>
      setVoices(speechSynthesis.getVoices().filter((v) => v.localService));
    update();
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", update);
      speechSynthesis.cancel();
    };
  }, []);
  useEffect(() => {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    setPlaying(null);
    setPaused(false);
  }, [draft]);
  const speak = (id: string, text: string) => {
    const voice = voices.find((v) => v.lang.toLowerCase().startsWith(language));
    if (!voice) {
      setMessage(
        `No local ${language === "bn" ? "Bangla" : "English"} voice is installed on this computer.`,
      );
      return;
    }
    speechSynthesis.cancel();
    setMessage(
      "Device voice preview. Verify pronunciation before patient use.",
    );
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.rate = 0.85;
    utterance.onend = () => {
      setPlaying(null);
      setPaused(false);
    };
    utterance.onerror = () => {
      setPlaying(null);
      setMessage(
        "Speech playback could not complete. The written instructions remain available.",
      );
    };
    setPlaying(id);
    setPaused(false);
    speechSynthesis.speak(utterance);
  };
  return (
    <>
      <div className="page-intro">
        <div>
          <Badge tone="blue">PATIENT READER</Badge>
          <h1>Your instructions, in focus.</h1>
          <p>A readable view of exactly what is written in this draft.</p>
        </div>
        <div className="toolbar">
          <button
            className="button"
            aria-label="Decrease text size"
            onClick={() => setSize(Math.max(16, size - 2))}
          >
            A−
          </button>
          <button
            className="button"
            aria-label="Increase text size"
            onClick={() => setSize(Math.min(28, size + 2))}
          >
            A+
          </button>
        </div>
      </div>
      <div className="reader-hero">
        <span className="avatar large">
          {draft.patient.name.slice(0, 1) || <Icon name="user" />}
        </span>
        <div>
          <h2>{draft.patient.name || "Select a patient"}</h2>
          <p>
            {draft.date} · {draft.clinician.name || "Prescriber not recorded"}
          </p>
        </div>
        <Badge tone="amber">
          {draft.synthetic ? "Fictional example" : "Unsigned draft"}
        </Badge>
      </div>
      <div className="reader-layout">
        <div style={{ fontSize: size }} className="reader-instructions">
          {draft.medications.length ? (
            draft.medications.map((m, i) => (
              <article
                className={`reader-medicine ${playing === m.id ? "speaking" : ""}`}
                key={m.id}
              >
                <div className="reader-medicine-top">
                  <span className="number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h2>{m.name || "Unnamed medicine"}</h2>
                    <p>{[m.strength, m.form].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Read ${m.name || "medicine"} instructions`}
                    onClick={() => speak(m.id, textFor(m))}
                  >
                    <Icon name="play" />
                  </button>
                </div>
                <div className="reader-dosage">
                  {[
                    ["Dose", m.dose],
                    ["When", m.frequency],
                    ["For", m.duration],
                    ["Route", m.route],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <small>{k}</small>
                      <strong>{v || "Not recorded"}</strong>
                    </div>
                  ))}
                </div>
                {m.instructions && <p>{m.instructions}</p>}
              </article>
            ))
          ) : (
            <div className="panel">
              <Empty
                icon="reader"
                title="Written instructions will appear here"
              >
                Add medicines in the prescription studio to build this patient
                view.
              </Empty>
            </div>
          )}
          {draft.advice && (
            <section className="reader-advice">
              <h3>Advice from your clinician</h3>
              <p>{draft.advice}</p>
            </section>
          )}
          {draft.followUp && (
            <section className="reader-advice">
              <h3>Next review</h3>
              <p>{draft.followUp}</p>
            </section>
          )}
        </div>
        <aside>
          <section className="panel listen-card">
            <span className="listen-icon">
              <Icon name="play" size={26} />
            </span>
            <h2>Listen to the written text</h2>
            <p>Keep these instructions on screen while listening.</p>
            <Field label="Local voice language">
              <select
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  window.speechSynthesis?.cancel();
                  setPlaying(null);
                }}
              >
                <option value="en">English</option>
                <option value="bn">বাংলা · Bangla</option>
              </select>
            </Field>
            <button
              className="button primary full"
              disabled={!draft.medications.length}
              onClick={() =>
                speak("all", draft.medications.map(textFor).join(". "))
              }
            >
              <Icon name="play" size={17} />
              Read all instructions
            </button>
            {playing && (
              <div className="toolbar">
                <button
                  className="button"
                  onClick={() => {
                    if (paused) speechSynthesis.resume();
                    else speechSynthesis.pause();
                    setPaused(!paused);
                  }}
                >
                  {paused ? "Resume" : "Pause"}
                </button>
                <button
                  className="button"
                  onClick={() => {
                    speechSynthesis.cancel();
                    setPlaying(null);
                  }}
                >
                  Stop
                </button>
              </div>
            )}
            <button
              className="text-link"
              onClick={() =>
                download(
                  "written-instructions.txt",
                  draft.medications.map(textFor).join("\n\n"),
                  "text/plain",
                )
              }
            >
              Download transcript
            </button>
            <p className="helper" role="status">
              {message ||
                "Local device voice preview. Neural speech and clinical pronunciation review are not configured."}
            </p>
          </section>
          <div className="notice subtle">
            <Icon name="info" />
            <p>
              This is a draft reader. Changes in the studio stop playback and
              update the written text.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

export function HistoryWorkspace({
  items,
  onOpen,
  onNewVisit,
  refresh,
}: {
  items: ConsultationSummary[];
  onOpen: (id: string) => void;
  onNewVisit: (item: ConsultationSummary) => void;
  refresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const visible = items.filter((c) =>
    `${c.patient.name} ${c.patient.reference} ${c.date}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-intro">
        <div>
          <Badge tone="blue">PATIENT RECORDS</Badge>
          <h1>Every visit, a clearer picture.</h1>
          <p>
            Reopen saved consultations or start a new visit for the same
            patient.
          </p>
        </div>
        <button className="button" onClick={refresh}>
          <Icon name="history" />
          Refresh records
        </button>
      </div>
      <div className="search-box">
        <Icon name="search" />
        <input
          aria-label="Search patient records"
          placeholder="Find a patient, record ID or visit date…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <kbd>{items.length} saved visits</kbd>
      </div>
      <section className="panel record-list">
        {visible.length ? (
          <>
            <div className="record-columns">
              <span>Patient</span>
              <span>Visit date</span>
              <span>Prescription</span>
              <span>Actions</span>
            </div>
            {visible.map((c) => (
              <div className="record-row" key={c.id}>
                <div className="record-patient">
                  <span className="avatar">{c.patient.name.slice(0, 1)}</span>
                  <span>
                    <strong>
                      {c.patient.name} {c.synthetic && <Badge>Fictional</Badge>}
                    </strong>
                    <small>
                      {c.patient.reference || "No reference ID"} ·{" "}
                      {c.patient.age || "Age not recorded"}
                    </small>
                  </span>
                </div>
                <span>
                  {c.date}
                  <small>
                    Updated{" "}
                    {new Date(c.updatedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </span>
                <span>
                  {c.medicationCount} medicines
                  <small>Draft · revision {c.revision}</small>
                </span>
                <div className="toolbar">
                  <button className="button small" onClick={() => onOpen(c.id)}>
                    Open <Icon name="arrow" size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Revision history for ${c.patient.name}`}
                    onClick={() => setHistoryId(c.id)}
                  >
                    <Icon name="history" size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`New visit for ${c.patient.name}`}
                    onClick={() => onNewVisit(c)}
                  >
                    <Icon name="plus" />
                  </button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <Empty
            icon="history"
            title={
              query
                ? "No matching visits"
                : "Your consultation history starts here"
            }
          >
            {query
              ? "Try a patient name, identifier or date."
              : "Save a consultation in the studio. It will be available here when you return."}
          </Empty>
        )}
      </section>
      {historyId && (
        <Modal
          title="Consultation revisions"
          wide
          onClose={() => setHistoryId(null)}
        >
          <RevisionHistory id={historyId} />
        </Modal>
      )}
    </>
  );
}

export function VitalsWorkspace({
  band,
  draft,
  onAttach,
}: {
  band: ReturnType<typeof useBand>;
  draft: ConsultationInput;
  onAttach: (ids: string[]) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const real = band.readings.filter((r) => r.source === "band");
  const latest = (field: keyof Reading) =>
    real.filter((r) => r[field] !== undefined).at(-1);
  const metrics = [
    ["heartRate", "Heart rate", "BPM", "vitals"],
    ["steps", "Steps", "steps", "vitals"],
    ["distanceMeters", "Distance", "m", "vitals"],
    ["calories", "Active calories", "kcal", "vitals"],
  ] as const;
  const available = real
    .filter(
      (r) =>
        r.id &&
        r.heartRate !== undefined &&
        !draft.vitalReadingIds.includes(r.id),
    )
    .slice(-5);
  const monitoring =
    band.online &&
    band.native?.running === true &&
    band.native.phase === "measuring";
  const sessionStart = Date.parse(band.native?.startedAt || "");
  const pulse = latest("heartRate");
  const fresh = (reading: Reading | undefined, seconds: number) =>
    Boolean(
      reading &&
        Date.parse(reading.observedAt) >= sessionStart &&
        now - Date.parse(reading.observedAt) <= seconds * 1000,
    );
  const live = monitoring && fresh(pulse, 25);
  const battery = latest("batteryPercent");
  const streamLabel = !band.online
    ? "Service offline · saved data"
    : live
      ? "LIVE · receiving heart rate"
      : monitoring
        ? "Waiting for a fresh heart-rate sample"
        : band.native?.running
          ? band.native.phase === "stopping"
            ? "Stopping monitoring"
            : "Connecting to band"
          : "STOPPED · saved observations";
  const heartSamples = real
    .filter(
      (r) =>
        r.heartRate !== undefined &&
        (!monitoring || Date.parse(r.observedAt) >= sessionStart),
    )
    .slice(-60);
  return (
    <>
      <div className="page-intro">
        <div>
          <Badge tone="blue">PATIENT VITALS</Badge>
          <h1>A closer view of the patient.</h1>
          <p>
            Actual device observations, with their original measurement times.
          </p>
        </div>
        <Badge tone={live ? "green" : "amber"}>{streamLabel}</Badge>
      </div>
      <div className="vital-cards">
        {metrics.map(([field, label, unit, icon]) => {
          const r = latest(field);
          return (
            <article className="vital-card" key={field}>
              <div>
                <Icon name={icon} />
                <span>{label}</span>
                <Badge tone={monitoring && fresh(r, 25) ? "green" : ""}>
                  {monitoring && fresh(r, 25)
                    ? "Live"
                    : monitoring
                      ? "Stale / waiting"
                      : "Saved"}
                </Badge>
              </div>
              <strong>
                {r?.[field] ?? "—"} <small>{unit}</small>
              </strong>
              <p>
                {r
                  ? `Observed ${Math.max(0, Math.floor((now - Date.parse(r.observedAt)) / 1000))}s ago · ${new Date(r.observedAt).toLocaleTimeString()}`
                  : "No measurement received"}
              </p>
              <div className="metric-line" />
            </article>
          );
        })}
      </div>
      <section className="panel live-trend">
        <div className="panel-bar">
          <strong>Heart-rate stream</strong>
          <Badge tone={live ? "green" : ""}>
            {heartSamples.length} recorded samples
          </Badge>
        </div>
        <div className="panel-body">
          {heartSamples.length ? (
            <Sparkline values={heartSamples.map((r) => r.heartRate!)} />
          ) : (
            <Empty icon="vitals" title="Waiting for measurements">
              No heart-rate values have arrived in this monitoring session.
            </Empty>
          )}
          <p className="helper">
            {monitoring
              ? "The line updates only when the band sends another measurement."
              : "Monitoring is stopped. This chart shows saved samples."}
          </p>
        </div>
      </section>
      <SleepHistoryPanel />
      <div className="two-columns">
        <section className="panel">
          <div className="panel-bar">
            <strong>Mi Smart Band 5</strong>
            <Icon name="bluetooth" />
          </div>
          <div className="panel-body">
            <p className="helper">
              Keep the paired band nearby with phone Bluetooth off. Wear it on
              your wrist for heart-rate readings.
            </p>
            {band.native?.available && (
              <div className="native-band-connect">
                <button
                  className="button primary full"
                  disabled={band.native.phase === "stopping"}
                  onClick={() =>
                    void (band.native?.running
                      ? band.stopNative()
                      : band.startNative())
                  }
                >
                  <Icon name="vitals" size={18} />
                  {band.native.running
                    ? "Stop live monitoring"
                    : "Start live monitoring"}
                </button>
                <p className="helper" role="status">
                  {band.native.message}
                </p>
                <p className="helper">
                  The connected computer reads Bluetooth every 10 seconds and
                  streams updates to this page. Monitoring continues when you
                  close the browser, until you stop it.
                </p>
                <div className="device-battery">
                  <Icon name="battery" size={17} />
                  <span>
                    Device battery: {battery?.batteryPercent ?? "—"}% ·{" "}
                    {battery
                      ? `checked ${new Date(battery.observedAt).toLocaleTimeString()}`
                      : "not read"}
                  </span>
                </div>
              </div>
            )}
            <Badge tone={band.online ? "green" : "amber"}>
              {band.online
                ? "Event stream connected · 10-second polling"
                : "Event stream disconnected · reconnecting"}
            </Badge>
            {band.native && !band.native.available && (
              <p className="notice">
                Select an enrolled Windows computer below, then start
                monitoring.
              </p>
            )}
            <DesktopBridges band={band} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-bar">
            <strong>Link observations to this visit</strong>
            <Icon name="link" />
          </div>
          <div className="panel-body">
            <p>
              Current patient:{" "}
              <strong>{draft.patient.name || "No patient selected"}</strong>
            </p>
            <p className="helper">
              Confirm that the band was worn by this patient at the recorded
              time. Measurements are never assigned automatically.
            </p>
            {available.length ? (
              available.map((r) => (
                <div className="observation" key={r.id}>
                  <span>
                    <strong>{r.heartRate} BPM</strong>
                    <small>{new Date(r.observedAt).toLocaleString()}</small>
                  </span>
                  <button
                    className="button small"
                    disabled={!draft.patient.name.trim() || draft.synthetic}
                    onClick={() => onAttach([r.id!])}
                  >
                    Attach
                  </button>
                </div>
              ))
            ) : (
              <p className="notice">
                No unattached heart-rate measurements are available. Battery
                readings are device status, not patient vitals.
              </p>
            )}
            <Badge>{draft.vitalReadingIds.length} observations linked</Badge>
          </div>
        </section>
      </div>
    </>
  );
}

export function EvidenceWorkspace({
  draft,
  capabilities,
}: {
  draft: ConsultationInput;
  capabilities: Capabilities | null;
}) {
  const [hash, setHash] = useState("");
  useEffect(() => {
    let active = true;
    setHash("");
    void crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(serializeDraft(draft)))
      .then((value) => {
        if (active)
          setHash(
            Array.from(new Uint8Array(value), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join(""),
          );
      });
    return () => {
      active = false;
    };
  }, [draft]);
  const facts = [
    [
      "Document origin",
      draft.synthetic
        ? "Fictional example"
        : draft.sources.length
          ? "Authored draft with manually linked sources"
          : "Locally authored draft",
    ],
    ["Digital signature", "Not signed"],
    ["Prescriber authority", "Not verified"],
    [
      "Native .lps validation",
      capabilities?.nativeLps ? "Available" : "Native bridge not connected",
    ],
    ["Recipient consent", "No disclosure request recorded"],
    ["Currentness", "No external status check performed"],
  ];
  return (
    <>
      <div className="page-intro">
        <div>
          <Badge tone="blue">EVIDENCE & TRUST</Badge>
          <h1>Know what the record proves.</h1>
          <p>Inspect each fact separately, alongside its limits.</p>
        </div>
        <Badge tone="amber">Unsigned local draft</Badge>
      </div>
      <div className="two-columns">
        <section className="panel">
          <div className="panel-bar">
            <strong>Document facts</strong>
            <Icon name="evidence" />
          </div>
          <dl className="facts roomy">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="panel">
          <div className="panel-bar">
            <strong>Draft fingerprint</strong>
            <Badge>SHA-256</Badge>
          </div>
          <div className="panel-body">
            <p>
              This fingerprint identifies the current MedDesk JSON draft. Any
              edit changes it.
            </p>
            <code className="hash">{hash || "Computing…"}</code>
            <p className="helper">
              A matching hash confirms matching bytes. It does not verify
              identity, clinical accuracy or prescribing authority.
            </p>
            <hr />
            <h3>Retained sources</h3>
            {draft.sources.length ? (
              draft.sources.map((s) => (
                <a
                  key={s.artifactId}
                  href={`/api/artifacts/${s.artifactId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="source-link"
                >
                  <Icon name="file" />
                  <span>
                    {s.name}
                    <small>{s.fields.join(", ")}</small>
                  </span>
                </a>
              ))
            ) : (
              <p className="helper">
                No source documents are linked to this draft.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export function PharmacyWorkspace({ draft }: { draft: ConsultationInput }) {
  const [selected, setSelected] = useState<string | null>(null);
  const med = draft.medications.find((m) => m.id === selected);
  return (
    <>
      <div className="page-intro">
        <div>
          <Badge tone="amber">WORKFLOW PREVIEW</Badge>
          <h1>A clear handover to pharmacy.</h1>
          <p>
            Keep the prescription, supply and administration records distinct.
          </p>
        </div>
        <Badge>Design preview</Badge>
      </div>
      <div className="workflow-track">
        {["Prescription", "Preparation", "Supply", "Administration"].map(
          (s, i) => (
            <div key={s}>
              <span>{i + 1}</span>
              <strong>{s}</strong>
              <small>{i === 0 ? "Unsigned draft" : "No event recorded"}</small>
            </div>
          ),
        )}
      </div>
      <section className="panel">
        <div className="panel-bar">
          <strong>{draft.patient.name || "Current consultation"}</strong>
          <Badge>{draft.medications.length} draft orders</Badge>
        </div>
        {draft.medications.length ? (
          draft.medications.map((m, i) => (
            <button
              className="pharmacy-row"
              key={m.id}
              onClick={() => setSelected(m.id)}
            >
              <span className="number">{i + 1}</span>
              <span>
                <strong>
                  {m.name || "Unnamed medicine"} {m.strength}
                </strong>
                <small>
                  {[m.dose, m.frequency, m.duration]
                    .filter(Boolean)
                    .join(" · ") || "Instructions incomplete"}
                </small>
              </span>
              <Badge tone="amber">Awaiting signed order</Badge>
              <Icon name="chevron" />
            </button>
          ))
        ) : (
          <Empty icon="pharmacy" title="No medicine orders to review">
            Author a prescription in the studio to inspect the handover view.
          </Empty>
        )}
      </section>
      {med && (
        <section className="panel panel-body">
          <h3>{med.name || "Selected medicine"}</h3>
          <dl className="facts">
            <div>
              <dt>Authored quantity</dt>
              <dd>{med.quantity || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Supply</dt>
              <dd>Not recorded</dd>
            </div>
            <div>
              <dt>Administration</dt>
              <dd>Not recorded</dd>
            </div>
          </dl>
          <div className="notice">
            Actual dispensing requires the native signed-order, authority and
            event services. This preview does not record a clinical action.
          </div>
        </section>
      )}
    </>
  );
}

const scenes = [
  [
    "S01",
    "Author & read",
    "studio",
    "Exact authoring, preview and file round trip",
  ],
  [
    "S02",
    "Source review",
    "import",
    "Original pages and accountable transcription",
  ],
  [
    "S03",
    "Medicine knowledge",
    "medicine",
    "Product identity and inspectable sources",
  ],
  [
    "S04",
    "Listen to instructions",
    "reader",
    "Written text and reviewed playback",
  ],
  [
    "S05",
    "Ask the prescription",
    "assistant",
    "Source-scoped questions and proposals",
  ],
  [
    "S06",
    "Visits & history",
    "history",
    "Patient-linked records and revisions",
  ],
  ["S07", "Pharmacy & bedside", "pharmacy", "Order, supply and administration"],
  [
    "S08",
    "Integrity & offline",
    "evidence",
    "Separate integrity and authority facts",
  ],
  [
    "S09",
    "Consent & sharing",
    "evidence",
    "Purpose, recipient and approved disclosure",
  ],
  [
    "S10",
    "Specialty care",
    "showcase",
    "Universal and specialist care coverage",
  ],
  [
    "S11",
    "Interoperability",
    "showcase",
    "Target profiles and explicit loss reports",
  ],
  [
    "S12",
    "Repair & preservation",
    "evidence",
    "Exact bytes and accountable custody",
  ],
  [
    "S13",
    "Search & reference data",
    "medicine",
    "Source-bound catalogs and indexes",
  ],
  [
    "S14",
    "Compiler & portability",
    "showcase",
    "Native limits and reproducible proof",
  ],
] as const;
export function ShowcaseWorkspace({
  navigate,
}: {
  navigate: (page: string) => void;
}) {
  const [scene, setScene] = useState("all"),
    [query, setQuery] = useState("");
  const rows = coverage.filter(
    (r) =>
      (scene === "all" || r.scenes.includes(scene)) &&
      `${r.id} ${r.title}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-intro">
        <div>
          <Badge tone="blue">PRODUCT SHOWCASE</Badge>
          <h1>One connected care workspace.</h1>
          <p>
            Explore all fourteen scenes and the complete 125-requirement product
            map.
          </p>
        </div>
        <button className="button primary" onClick={() => navigate("demo")}>Open prescription demo</button>
      </div>
      <div className="scene-grid">
        {scenes.map(([id, title, page, description]) => (
          <button
            className={`scene-card ${scene === id ? "active" : ""}`}
            key={id}
            onClick={() => setScene(scene === id ? "all" : id)}
          >
            <span>
              {id}
              <Icon name={page === "assistant" ? "spark" : page} />
            </span>
            <h3>{title}</h3>
            <p>{description}</p>
            <small>
              {coverage.filter((r) => r.scenes.includes(id)).length} mapped
              requirements
            </small>
          </button>
        ))}
      </div>
      <section className="panel coverage-panel">
        <div className="panel-bar">
          <strong>
            {scene === "all"
              ? "Complete product map"
              : `${scene} · ${scenes.find((s) => s[0] === scene)?.[1]}`}
          </strong>
          <div className="toolbar">
            {scene !== "all" && (
              <button
                className="button small"
                onClick={() => {
                  const page = scenes.find((s) => s[0] === scene)?.[2];
                  if (page && page !== "showcase") navigate(page);
                  else setQuery("");
                }}
              >
                Explore workspace <Icon name="arrow" size={14} />
              </button>
            )}
            <Badge>{rows.length} / 125</Badge>
          </div>
        </div>
        <div className="search-box compact-search">
          <Icon name="search" />
          <input
            aria-label="Search product requirements"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search capability, specialty or requirement ID…"
          />
          {scene !== "all" && (
            <button className="text-link" onClick={() => setScene("all")}>
              Show all
            </button>
          )}
        </div>
        <div className="coverage-list">
          {rows.map((r) => (
            <details key={r.id}>
              <summary>
                <code>{r.id}</code>
                <span>{r.title}</span>
                <Icon name="down" size={16} />
              </summary>
              <div>
                <Badge>{r.scenes.join(" · ")}</Badge>
                <p>
                  <strong>Required proof:</strong> {r.proof}
                </p>
                <p className="helper">
                  Mapped from the main product plan. This row is not a claim of
                  completed native implementation or clinical validation.
                </p>
              </div>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
