import { workspaceFetch } from "../lib/session";
import { useEffect, useRef, useState } from "react";
import type { DictationAction, DictationTarget } from "../lib/dictation";

interface RecognitionResult { isFinal: boolean; 0: { transcript: string }; }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function DictationTool({ onInsert, targets, initialLanguage = "en-US" }: {
  onInsert: (text: string, target: string, action: DictationAction) => unknown;
  targets: DictationTarget[];
  initialLanguage?: string;
}) {
  const [targetId, setTargetId] = useState(() => targets.find(target => target.id === JSON.stringify([null, "complaints"]))?.id || targets[0]?.id || "");
  const [action, setAction] = useState<DictationAction>("append");
  const target = targets.find(item => item.id === targetId);
  const groups = [...new Set(targets.map(item => item.group))];
  const [language, setLanguage] = useState(initialLanguage);
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [mode, setMode] = useState("idle");
  const [status, setStatus] = useState("Ready");
  const [sample, setSample] = useState<Blob | null>(null);
  const [sampleUrl, setSampleUrl] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [capturedBytes, setCapturedBytes] = useState(0);
  const [microphone, setMicrophone] = useState("");
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [inputId, setInputId] = useState("");
  const [level, setLevel] = useState(0);
  const [serverReady, setServerReady] = useState(false);
  const [sampleLanguage, setSampleLanguage] = useState(language);
  const forDictation = useRef(false);
  const meter = useRef<{ context: AudioContext; timer: ReturnType<typeof setInterval> } | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upload = useRef<AbortController | null>(null);
  const version = useRef(0);
  const url = useRef("");
  const Constructor = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
  const busy = mode !== "idle";
  const clearSpeechTimer = () => { if (speechTimer.current) clearTimeout(speechTimer.current); speechTimer.current = null; };
  const stopTracks = () => {
    if (meter.current) { clearInterval(meter.current.timer); void meter.current.context.close(); meter.current = null; }
    setLevel(0);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const refreshInputs = () => {
    void navigator.mediaDevices?.enumerateDevices?.().then(devices => setInputs(devices.filter(device => device.kind === "audioinput"))).catch(() => {});
  };
  useEffect(() => {
    const abort = new AbortController();
    refreshInputs();
    void workspaceFetch("/api/transcription/status", { signal: abort.signal }).then(response => response.ok ? response.json() : null)
      .then(value => { if (!abort.signal.aborted) setServerReady(value?.available === true); }).catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => () => {
    version.current++;
    clearSpeechTimer();
    recognition.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    stopTracks();
    upload.current?.abort();
    URL.revokeObjectURL(url.current);
  }, []);
  useEffect(() => {
    if (mode !== "recording") return;
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(tick);
  }, [mode]);
  const dictate = () => {
    if (!Constructor || busy) return;
    const session = ++version.current;
    const current = new Constructor();
    recognition.current = current;
    current.lang = language;
    current.continuous = true;
    current.interimResults = true;
    const finalized = new Set<number>();
    let failed = false;
    const fail = (message: string) => {
      if (session !== version.current) return;
      failed = true; version.current++; clearSpeechTimer();
      recognition.current = null; setMode("idle"); setInterim(""); setStatus(message);
      try { current.abort(); } catch {}
    };
    setMode("starting");
    setStatus("Allow microphone access to start dictation.");
    current.onstart = () => {
      if (session !== version.current) return;
      clearSpeechTimer();
      setMode("listening"); setStatus("Listening — speak your instructions.");
    };
    current.onresult = (event) => {
      if (session !== version.current || failed) return;
      const completed: string[] = [], partial: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal && !finalized.has(i)) { finalized.add(i); completed.push(result[0].transcript); }
        else if (!result.isFinal) partial.push(result[0].transcript);
      }
      if (completed.length) setText((previous) => [previous, ...completed].filter(Boolean).join(" "));
      setInterim(partial.join(" "));
    };
    current.onerror = (event) => {
      if (session !== version.current) return;
      const messages: Record<string, string> = {
        "not-allowed": "Microphone access was denied. Allow it in the browser's site settings.",
        "service-not-allowed": "This browser's speech service is unavailable. Try Chrome or record an audio sample.",
        "audio-capture": "No microphone is available. Check the selected input device.",
        "network": "The browser's speech service could not connect. Check the connection or record a sample.",
        "no-speech": "No speech was detected. Start again when ready.",
        "language-not-supported": "The speech service does not support this language. Try another browser or record a sample.",
      };
      fail(messages[event.error] || `Dictation stopped (${event.error}). Your recognized text is retained.`);
    };
    current.onend = () => {
      if (session !== version.current) return;
      clearSpeechTimer();
      recognition.current = null; setMode("idle"); setInterim("");
      if (!failed) setStatus("Dictation stopped. Review the words and numbers before inserting.");
    };
    speechTimer.current = setTimeout(() => fail("The speech service did not start. Try again or record an audio sample below."), 20000);
    try { current.start(); }
    catch { fail("Dictation could not start. Check microphone access."); }
  };
  const record = async (dictation = false) => {
    if (busy) return;
    const session = ++version.current;
    forDictation.current = dictation;
    setMode("starting-recording"); setStatus("Allow microphone access to begin.");
    setElapsed(0); setCapturedBytes(0); setMicrophone("");
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: inputId ? { deviceId: { exact: inputId } } : true });
      if (session !== version.current) { input.getTracks().forEach((track) => track.stop()); return; }
      stream.current = input;
      setMicrophone(input.getAudioTracks?.()[0]?.label || "Selected microphone");
      refreshInputs();
      if (typeof AudioContext !== "undefined") {
        try {
          const context = new AudioContext(), source = context.createMediaStreamSource(input), analyser = context.createAnalyser();
          analyser.fftSize = 256; source.connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const tick = setInterval(() => {
            analyser.getByteTimeDomainData(data);
            const rms = Math.sqrt(data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / data.length);
            if (session === version.current) setLevel(Math.min(1, rms * 4));
          }, 100);
          meter.current = { context, timer: tick }; void context.resume().catch(() => {});
        } catch {}
      }
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(input, mime ? { mimeType: mime } : undefined);
      recorder.current = current;
      const chunks: Blob[] = [];
      let bytes = 0, recordingFailed = false;
      current.ondataavailable = (event) => {
        if (session !== version.current || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > 8 * 1024 * 1024) {
          recordingFailed = true; if (current.state === "recording") current.stop(); setStatus("The sample exceeded 8 MB. Record a shorter sample.");
        } else chunks.push(event.data);
        setCapturedBytes(bytes);
      };
      current.onerror = () => { recordingFailed = true; input.getTracks().forEach((track) => track.stop()); if (session === version.current) { stopTracks(); setMode("idle"); setStatus("Recording failed. Try your microphone again."); } };
      current.onstop = () => {
        input.getTracks().forEach((track) => track.stop());
        if (session !== version.current) return;
        stream.current = null; stopTracks(); recorder.current = null;
        setMode("idle");
        if (recordingFailed) return;
        const audio = new Blob(chunks, { type: current.mimeType });
        if (!audio.size) { setStatus("No audio was captured. Try again."); return; }
        URL.revokeObjectURL(url.current);
        url.current = URL.createObjectURL(audio);
        setSample(audio); setSampleUrl(url.current); setSampleLanguage(language);
        setStatus("Sample ready. Listen before sending it for comparison.");
        if (dictation) void transcribe(audio, language);
      };
      current.start(1000); setMode("recording"); setStatus(dictation ? "Recording. Stop when you finish speaking." : "Recording your sample — maximum 60 seconds.");
      timer.current = setTimeout(() => { if (current.state === "recording") current.stop(); }, 60000);
    } catch (error) {
      stopTracks();
      recorder.current = null;
      const name = error instanceof Error ? error.name : "UnknownError";
      const messages: Record<string, string> = {
        NotAllowedError: "Microphone access was blocked. Check this site's permission and Windows microphone privacy settings.",
        NotReadableError: "The microphone was allowed but could not be opened. Close another app using it or select another input in your browser settings.",
        NotFoundError: "No microphone was found. Connect one and select it in your browser settings.",
        NotSupportedError: "This browser could not record the audio format. Try an up-to-date Chrome or Edge browser.",
      };
      if (session === version.current) { setMode("idle"); setStatus(messages[name] || `Recording could not start (${name}). Check your microphone input.`); }
    }
  };
  const transcribe = async (audio: Blob, spokenLanguage: string) => {
    const session = version.current, controller = new AbortController(); upload.current = controller;
    setMode("transcribing"); setStatus("Transcribing your recording…");
    try {
      const response = await workspaceFetch("/api/transcription", { method: "POST", headers: { "Content-Type": audio.type, "X-Audio-Language": spokenLanguage }, body: audio, signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Transcription failed. Your recording is available for retry.");
      if (typeof result.text !== "string" || !result.text.trim()) throw new Error("No speech was returned. Check the microphone level and try again.");
      if (session === version.current && !controller.signal.aborted) {
        setText(previous => [previous, result.text].filter(Boolean).join(" "));
        setStatus("Transcription ready. Review the words and numbers before inserting.");
      }
    } catch (error) { if (session === version.current && !controller.signal.aborted) setStatus((error as Error).message); }
    finally { if (session === version.current && !controller.signal.aborted) { setMode("idle"); upload.current = null; } }
  };
  const sendSample = async () => {
    if (!sample || busy) return;
    const controller = new AbortController(); upload.current = controller;
    setMode("uploading"); setStatus("Sending your sample for the requested comparison…");
    try {
      const response = await workspaceFetch("/api/audio-samples", { method: "POST", headers: { "Content-Type": sample.type, "X-Audio-Language": sampleLanguage }, body: sample, signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The sample could not be sent.");
      if (!controller.signal.aborted) setStatus(`Sample received: ${result.sample.id}. Comparison is pending.`);
    } catch (error) { if (!controller.signal.aborted) setStatus((error as Error).message); }
    finally { if (!controller.signal.aborted) setMode("idle"); upload.current = null; }
  };
  return <div className="dictation-tool">
    <section className={`dictation-controls ${mode === "recording" || mode === "listening" ? "is-recording" : ""}`} aria-label="Recording controls">
      <div className="dictation-heading"><h3>Dictate prescription</h3>{mode === "recording" && <span className="dictation-timer" aria-label="Recording duration">{elapsed}s / 60s</span>}</div>
      <p className="dictation-destination" title={target?.label}>For: {target?.label || "Choose a prescription field"}</p>
      {mode === "recording" ? <button className="button dictation-stop" onClick={() => {
        if (recorder.current?.state === "recording") { setMode("finishing-recording"); recorder.current.stop(); }
      }}><span aria-hidden="true">■</span>{forDictation.current ? "Stop dictation" : "Stop recording"}</button>
      : (mode === "listening" || mode === "starting") ? <button className="button dictation-stop" onClick={() => {
        const current = recognition.current;
        setMode("stopping");
        clearSpeechTimer();
        speechTimer.current = setTimeout(() => {
          version.current++; recognition.current = null; setMode("idle"); setInterim("");
          setStatus("Dictation stopped. Review your captured text.");
          try { current?.abort(); } catch {}
        }, 2000);
        try { current?.stop(); } catch { current?.abort(); }
      }}><span aria-hidden="true">■</span>Stop dictation</button>
      : mode === "starting-recording" ? <button className="button" onClick={() => { version.current++; setMode("idle"); setStatus("Microphone request cancelled. You can try again."); }}>Cancel microphone request</button>
      : mode === "transcribing" ? <button className="button" onClick={() => { upload.current?.abort(); upload.current = null; setMode("idle"); setStatus("Transcription cancelled. Your recording is available for retry."); }}>Cancel transcription</button>
      : <button className="button primary" disabled={busy || (!serverReady && !Constructor)} onClick={() => { if (serverReady) void record(true); else dictate(); }}>{busy ? "Finishing…" : "Start dictation"}</button>}
      {mode === "recording" && <meter min={0} max={1} value={level} aria-label="Microphone input level" />}
      <p role="status" className="helper">{status}</p>
    </section>
    <div className="dictation-body">
      <label className="field"><span>Prescription field</span><select value={target?.id || ""} disabled={busy} onChange={event => { setTargetId(event.target.value); setAction("append"); }}>
        {!target && <option value="">Choose a field</option>}
        {groups.map(group => <optgroup key={group} label={group}>{targets.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
      </select></label>
      {target && <p className="helper dictation-location">{target.group}</p>}
      <label className="field"><span>Spoken language</span><select value={language} disabled={busy} onChange={event => setLanguage(event.target.value)}>
        <option value="en-US">English</option><option value="bn-BD">বাংলা · Bangladesh</option><option value="bn-IN">বাংলা · India</option>
      </select></label>
      <p className="helper">Choose one field, dictate, then review. Check names, numbers and units before applying.</p>
      {interim && <p className="dictation-interim" aria-live="polite">{interim}</p>}
      <label className="field"><span>Recognized text</span><textarea rows={5} placeholder="Your words appear here after you stop. You can also type or correct them." value={text} disabled={busy} onChange={event => setText(event.target.value)} /></label>
      <label className="field"><span>Apply as</span><select value={action} disabled={busy} onChange={event => setAction(event.target.value as DictationAction)}>
        <option value="append">Add to existing text</option><option value="replace">Replace this field's text</option>
      </select></label>
      {target && <div className="dictation-preview" aria-label="Prescription field preview">
        <strong>{target.label}</strong>
        <small>{text.trim() ? "After applying" : "Currently on prescription"}</small>
        <p>{text.trim() ? [action === "append" ? target.value : "", text].filter(Boolean).join("\n") : target.value || "Empty field"}</p>
      </div>}
      <button className="button primary full" disabled={busy || !text.trim() || !target} onClick={() => {
        if (!target) return;
        if (onInsert(text, target.id, action) !== false) { setText(""); setStatus(`Applied to ${target.label}. Review it on the prescription.`); }
        else setStatus("This field changed or was removed. Choose its destination again; your text is retained.");
      }}>{target ? `${action === "append" ? "Add to" : "Replace"} ${target.label}` : "Choose a prescription field"}</button>
      {sampleUrl && <div className="dictation-playback"><audio className="dictation-audio" src={sampleUrl} controls aria-label="Your audio sample" />{serverReady && <button className="button full" disabled={busy} onClick={() => { if (sample) void transcribe(sample, sampleLanguage); }}>Transcribe recording</button>}</div>}
      <details className="dictation-settings"><summary>Microphone & recording settings</summary>
        <label className="field"><span>Microphone</span><select value={inputId} disabled={busy} onChange={event => setInputId(event.target.value)}><option value="">Browser default microphone</option>{inputs.filter(input => input.deviceId !== "default").map((input, index) => <option value={input.deviceId} key={input.deviceId}>{input.label || `Microphone ${index + 1}`}</option>)}</select></label>
        {microphone && <p className="helper">{microphone} · {Math.ceil(capturedBytes / 1024)} KB captured</p>}
        <p className="helper">If the input meter stays flat while speaking, stop and choose another microphone.</p>
        {!Constructor && !serverReady && <p className="helper">Speech recognition is unavailable. You can still record a sample below.</p>}
        <p className="helper">{serverReady ? "Start dictation records your voice. When you stop, audio is sent to this MedDesk server for transcription and is not saved there." : "Live dictation uses your browser's speech service, which may process audio online."}</p>
        {serverReady && Constructor && <><button className="button full" disabled={busy} onClick={dictate}>Use browser dictation</button><p className="helper">Browser dictation uses the browser’s own speech service.</p></>}
      </details>
      <details><summary>Audio sample comparison</summary>
        <p className="helper">Record a test phrase without patient details. Recording stays in this browser until you send it. Sending saves the sample privately for comparison.</p>
        <button className="button full" disabled={busy || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined"} onClick={() => void record()}>Record audio sample</button>
        {sampleUrl && <button className="button full" disabled={busy} onClick={() => void sendSample()}>Send sample for comparison</button>}
      </details>
    </div>
  </div>;
}
