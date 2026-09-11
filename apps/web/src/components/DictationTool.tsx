import { useEffect, useRef, useState } from "react";

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

export function DictationTool({ onInsert }: { onInsert: (text: string) => unknown }) {
  const [language, setLanguage] = useState("bn-BD");
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [mode, setMode] = useState("idle");
  const [status, setStatus] = useState("Ready");
  const [sample, setSample] = useState<Blob | null>(null);
  const [sampleUrl, setSampleUrl] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upload = useRef<AbortController | null>(null);
  const version = useRef(0);
  const url = useRef("");
  const Constructor = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
  const busy = mode !== "idle";
  const stopTracks = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => () => {
    version.current++;
    recognition.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    stopTracks();
    upload.current?.abort();
    URL.revokeObjectURL(url.current);
  }, []);
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
    setMode("starting");
    setStatus("Allow microphone access to start dictation.");
    current.onstart = () => {
      if (session !== version.current) return;
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
      failed = true;
      const messages: Record<string, string> = {
        "not-allowed": "Microphone access was denied. Allow it in the browser's site settings.",
        "service-not-allowed": "This browser's speech service is unavailable. Try Chrome or record an audio sample.",
        "audio-capture": "No microphone is available. Check the selected input device.",
        "network": "The browser's speech service could not connect. Check the connection or record a sample.",
        "no-speech": "No speech was detected. Start again when ready.",
        "language-not-supported": "The speech service does not support this language. Try another browser or record a sample.",
      };
      setStatus(messages[event.error] || "Dictation stopped. Your recognized text is retained.");
      setInterim("");
    };
    current.onend = () => {
      if (session !== version.current) return;
      recognition.current = null; setMode("idle"); setInterim("");
      if (!failed) setStatus("Dictation stopped. Review the words and numbers before inserting.");
    };
    try { current.start(); }
    catch { recognition.current = null; setMode("idle"); setStatus("Dictation could not start. Check microphone access."); }
  };
  const record = async () => {
    if (busy) return;
    const session = ++version.current;
    setMode("starting-recording"); setStatus("Allow microphone access to record your sample.");
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session !== version.current) { input.getTracks().forEach((track) => track.stop()); return; }
      stream.current = input;
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
        setSample(audio); setSampleUrl(url.current);
        setStatus("Sample ready. Listen before sending it for comparison.");
      };
      current.start(1000); setMode("recording"); setStatus("Recording your sample — maximum 60 seconds.");
      timer.current = setTimeout(() => { if (current.state === "recording") current.stop(); }, 60000);
    } catch {
      stopTracks();
      if (session === version.current) { setMode("idle"); setStatus("Recording could not start. Allow microphone access and check your input device."); }
    }
  };
  const sendSample = async () => {
    if (!sample || busy) return;
    const controller = new AbortController(); upload.current = controller;
    setMode("uploading"); setStatus("Sending your sample for the requested comparison…");
    try {
      const response = await fetch("/api/audio-samples", { method: "POST", headers: { "Content-Type": sample.type, "X-Audio-Language": language }, body: sample, signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The sample could not be sent.");
      if (!controller.signal.aborted) setStatus(`Sample received: ${result.sample.id}. Model comparison is pending; no accuracy score has been assigned.`);
    } catch (error) { if (!controller.signal.aborted) setStatus((error as Error).message); }
    finally { if (!controller.signal.aborted) setMode("idle"); upload.current = null; }
  };
  return <div>
    <h3>Speech to text</h3>
    <p className="helper">Dictate, review the recognized words, then insert them at your cursor. Check medicine names, numbers and units.</p>
    <label className="field"><span>Spoken language</span><select value={language} disabled={busy} onChange={(event) => setLanguage(event.target.value)}>
      <option value="bn-BD">বাংলা · Bangladesh</option><option value="en-US">English</option><option value="bn-IN">বাংলা · India</option>
    </select></label>
    <div className="toolbar">
      <button className="button primary" disabled={busy || !Constructor} onClick={dictate}>Start dictation</button>
      {(mode === "listening" || mode === "starting") && <button className="button" onClick={() => { setMode("stopping"); recognition.current?.stop(); }}>Stop dictation</button>}
    </div>
    {!Constructor && <p className="helper">Live speech recognition is unavailable in this browser. Use a supported Chrome browser or record a sample below.</p>}
    <p className="helper">Live dictation uses your browser's speech service, which may process audio online.</p>
    <p className="dictation-interim" aria-live="polite">{interim}</p>
    <label className="field"><span>Recognized text</span><textarea rows={5} value={text} disabled={busy} onChange={(event) => setText(event.target.value)} /></label>
    <button className="button full" disabled={busy || !text.trim()} onClick={() => { if (onInsert(text) !== false) { setText(""); setStatus("Recognized text inserted. Review it in the prescription."); } }}>Insert text at cursor</button>
    <hr />
    <h4>Audio sample comparison</h4>
    <p className="helper">Record a short test phrase without patient details. Recording stays in this browser until you send it. Sending saves the sample privately for the requested model comparison.</p>
    <div className="toolbar"><button className="button" disabled={busy || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined"} onClick={() => void record()}>Record audio sample</button>
      {mode === "recording" && <button className="button" onClick={() => recorder.current?.stop()}>Stop recording</button>}
    </div>
    {sampleUrl && <><audio className="dictation-audio" src={sampleUrl} controls aria-label="Your audio sample" /><button className="button primary full" disabled={busy} onClick={() => void sendSample()}>Send sample for comparison</button></>}
    <p role="status" className={mode === "recording" || mode === "listening" ? "dictation-recording" : "helper"}>{status}</p>
  </div>;
}
