import { workspaceFetch } from "../lib/session";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/clinic";
import type { SpeechVoice } from "../../../server/src/speech";
export function SpeechTool({ text, language = "en" }: { text: string; language?: "en" | "bn" }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [windows, setWindows] = useState<SpeechVoice[]>([]),
    [selected, setSelected] = useState(""),
    [rate, setRate] = useState(1),
    [status, setStatus] = useState("Ready"),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    [audioUrl, setAudioUrl] = useState("");
  const player = useRef<HTMLAudioElement>(null),
    pending = useRef<AbortController | null>(null),
    objectUrl = useRef("");
  const generation = useRef(0);
  const bengali = /[\u0980-\u09ff]/.test(text);
  const available = typeof speechSynthesis !== "undefined";
  useEffect(() => {
    let active = true;
    void api<{ voices: SpeechVoice[] }>("/api/speech/voices")
      .then((value) => {
        if (active) {
          setWindows(value.voices || []);
        }
      })
      .catch(() => {});
    if (available) {
      const refresh = () => setVoices(speechSynthesis.getVoices());
      refresh();
      speechSynthesis.addEventListener("voiceschanged", refresh);
      return () => {
        generation.current++;
        active = false;
        speechSynthesis.removeEventListener("voiceschanged", refresh);
        speechSynthesis.cancel();
        pending.current?.abort();
        URL.revokeObjectURL(objectUrl.current);
      };
    }
    return () => {
      generation.current++;
      active = false;
      pending.current?.abort();
      URL.revokeObjectURL(objectUrl.current);
    };
  }, [available]);
  useEffect(() => {
    if (selected) return;
    const local = windows.find((voice) =>
      voice.language.toLowerCase().startsWith(language),
    );
    const browser = voices.find((voice) =>
      voice.lang.toLowerCase().startsWith(language),
    );
    if (local) setSelected("windows:" + local.name);
    else if (browser) setSelected("browser:" + browser.voiceURI);
  }, [windows, voices, language, selected]);
  useEffect(() => {
    generation.current++;
    if (available) speechSynthesis.cancel();
    pending.current?.abort();
    player.current?.pause();
    URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
    setAudioUrl("");
    setPlaying(false);
    setBusy(false);
    setStatus("Ready — using current document text");
  }, [text, available]);
  const play = async () => {
    const version = ++generation.current;
    if (available) speechSynthesis.cancel();
    player.current?.pause();
    setStatus("Preparing speech…");
    if (selected.startsWith("windows:")) {
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      try {
        const response = await workspaceFetch("/api/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: selected.slice(8),
            rate: Math.round((rate - 1) * 5),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Speech could not be generated.");
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        setAudioUrl(objectUrl.current);
        setStatus("Speech ready. Use the audio controls to play.");
      } catch (error) {
        if (!controller.signal.aborted) setStatus((error as Error).message);
      } finally {
        if (pending.current === controller) {
          pending.current = null;
          setBusy(false);
        }
      }
    } else if (available) {
      const voice = voices.find(
        (voice) => voice.voiceURI === selected.slice(8),
      );
      if (!voice) {
        setStatus("Select an available browser voice.");
        return;
      }
      if (bengali && !voice.lang.toLowerCase().startsWith("bn")) {
        setStatus("This document contains Bengali. Select a Bengali voice.");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = rate;
      utterance.onstart = () => {
        if (version !== generation.current) return;
        setPlaying(true);
        setStatus("Reading the document");
      };
      utterance.onend = () => {
        if (version !== generation.current) return;
        setPlaying(false);
        setStatus("Finished");
      };
      utterance.onerror = () => {
        if (version !== generation.current) return;
        setPlaying(false);
        setStatus("Speech could not be played. Choose another voice.");
      };
      speechSynthesis.speak(utterance);
    }
  };
  return (
    <div>
      <h3>Listen to the prescription</h3>
      <p className="helper">
        Review the spoken source text below. Editing stops speech and removes
        audio from the previous draft.
      </p>
      <label className="field">
        <span>Voice</span>
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Choose a voice</option>
          {windows.map((voice) => (
            <option key={voice.name} value={`windows:${voice.name}`}>
              {voice.name} · {voice.language}
            </option>
          ))}
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={`browser:${voice.voiceURI}`}>
              {voice.name} · {voice.lang} · browser
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Speed · {rate}×</span>
        <input
          type="range"
          min="0.6"
          max="1.4"
          step="0.1"
          value={rate}
          onChange={(event) => setRate(Number(event.target.value))}
        />
      </label>
      <div className="toolbar">
        <button
          className="button primary"
          disabled={busy || !selected || !text.trim()}
          onClick={() => void play()}
        >
          {busy ? "Generating speech…" : "Read aloud"}
        </button>
        {busy && (
          <button className="button" onClick={() => pending.current?.abort()}>
            Cancel
          </button>
        )}
        {playing && (
          <>
            <button
              className="button"
              onClick={() => {
                speechSynthesis.paused
                  ? speechSynthesis.resume()
                  : speechSynthesis.pause();
                setStatus(
                  speechSynthesis.paused ? "Paused" : "Reading the document",
                );
              }}
            >
              Pause / resume
            </button>
            <button
              className="button"
              onClick={() => {
                generation.current++;
                speechSynthesis.cancel();
                setPlaying(false);
                setStatus("Stopped");
              }}
            >
              Stop
            </button>
          </>
        )}
      </div>
      {audioUrl && (
        <audio
          ref={player}
          src={audioUrl}
          controls
          autoPlay
          aria-label="Prescription audio"
          style={{ width: "100%" }}
        />
      )}
      <p role="status" className="helper">
        {status}
      </p>
      <details>
        <summary>Text that will be spoken</summary>
        <pre className="speech-transcript">{text}</pre>
      </details>
    </div>
  );
}
