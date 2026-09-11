import { useEffect, useState } from "react";
import { api } from "../lib/clinic";
import { Badge } from "./ui";
import type { SleepHistory } from "../../../server/src/sleep";

export function SleepHistoryPanel() {
  const [history, setHistory] = useState<SleepHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<SleepHistory>("/api/sleep")
      .then((value) => {
        if (active) setHistory(value);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const sync = async () => {
    setBusy(true);
    setError("");
    try {
      setHistory(
        await api<SleepHistory>("/api/sleep/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel sleep-history">
      <div className="panel-bar">
        <strong>Sleep history</strong>
        <Badge>Zepp account · recorded nights</Badge>
      </div>
      <div className="panel-body">
        <p className="helper">
          Sleep history is synced separately from current Bluetooth readings.
          Measurements below come from your Zepp account.
        </p>
        <button className="button" disabled={busy} onClick={() => void sync()}>
          {busy ? "Syncing sleep…" : "Sync sleep history"}
        </button>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        {history?.status === "empty" && (
          <p className="notice">
            No sleep records were returned by Zepp for the last 7 days. Sleep
            duration is unavailable. This does not mean you slept zero hours.
          </p>
        )}
        {history?.status === "not-synced" && (
          <p className="helper">Sleep has not been synced yet.</p>
        )}
        {history?.sessions?.map((session) => (
          <div
            className="observation"
            key={`${session.start}-${session.sourceHash}`}
          >
            <span>
              <strong>{session.date}</strong>
              <small>
                {new Date(session.start).toLocaleString()} –{" "}
                {new Date(session.end).toLocaleString()}
              </small>
            </span>
            <span>
              Deep:{" "}
              {session.deepMinutes === undefined
                ? "unavailable"
                : `${session.deepMinutes} min`}{" "}
              · Light:{" "}
              {session.lightMinutes === undefined
                ? "unavailable"
                : `${session.lightMinutes} min`}
              {session.score !== undefined ? ` · Score: ${session.score}` : ""}
            </span>
          </div>
        ))}
        {history?.syncedAt && (
          <p className="helper">
            Last checked {new Date(history.syncedAt).toLocaleString()}
          </p>
        )}
      </div>
    </section>
  );
}
