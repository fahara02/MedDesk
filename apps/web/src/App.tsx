import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkline } from "./components/Sparkline";
import { loadReadings, saveReading } from "./lib/api";
import { MiBand5Client } from "./lib/miband";
import type { BandSnapshot, ConnectionPhase, Reading } from "./types";

const phaseLabels: Record<ConnectionPhase, string> = {
  idle: "Ready to connect",
  selecting: "Choose your band",
  connecting: "Connecting",
  authenticating: "Authenticating",
  connected: "Live",
  disconnected: "Disconnected",
  error: "Needs attention",
  demo: "Demo stream",
};

export default function App() {
  const [authKey, setAuthKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [phase, setPhase] = useState<ConnectionPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("Use Chrome or Edge on this PC and keep the band close.");
  const [current, setCurrent] = useState<Reading | null>(null);
  const [history, setHistory] = useState<Reading[]>([]);
  const [serverOnline, setServerOnline] = useState(false);
  const bandClient = useRef<MiBand5Client | null>(null);
  const demoTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void loadReadings()
      .then((readings) => {
        setHistory(readings);
        if (readings.length) setCurrent(readings.at(-1) ?? null);
        setServerOnline(true);
      })
      .catch(() => setServerOnline(false));

    const events = new EventSource("/api/events");
    events.addEventListener("ready", () => setServerOnline(true));
    events.addEventListener("reading", (event) => {
      const reading = JSON.parse((event as MessageEvent).data) as Reading;
      setCurrent(reading);
      setHistory((existing) => [...existing.slice(-119), reading]);
    });
    events.onerror = () => setServerOnline(false);
    return () => events.close();
  }, []);

  useEffect(() => () => window.clearInterval(demoTimer.current), []);

  const connect = async () => {
    stopDemo();
    const client = new MiBand5Client({
      onPhase: (nextPhase, message) => {
        setPhase(nextPhase);
        if (message) setStatusMessage(message);
      },
      onSnapshot: (snapshot) => void submitSnapshot(snapshot, "band"),
    });
    bandClient.current = client;
    try {
      await client.connect(authKey);
    } catch (error) {
      setPhase("error");
      setStatusMessage(error instanceof Error ? error.message : "Could not connect to the band.");
    }
  };

  const disconnect = async () => {
    await bandClient.current?.disconnect();
    bandClient.current = null;
  };

  const submitSnapshot = async (snapshot: BandSnapshot, source: Reading["source"]) => {
    const reading: Reading = {
      ...snapshot,
      observedAt: snapshot.observedAt || new Date().toISOString(),
      source,
    };
    setCurrent(reading);
    try {
      await saveReading(reading);
      setServerOnline(true);
    } catch {
      setServerOnline(false);
      setHistory((existing) => [...existing.slice(-119), reading]);
    }
  };

  const startDemo = async () => {
    await bandClient.current?.disconnect();
    bandClient.current = null;
    stopDemo();
    setPhase("demo");
    setStatusMessage("Showing generated readings so you can review the dashboard.");
    let tick = 0;
    const createDemoReading = () => {
      const wave = Math.sin(tick / 2.4);
      tick += 1;
      void submitSnapshot(
        {
          deviceName: "Mi Band 5 · preview",
          observedAt: new Date().toISOString(),
          heartRate: Math.round(76 + wave * 8 + Math.random() * 3),
          steps: 6842 + tick * 3,
          distanceMeters: 4930 + tick * 2,
          calories: 286,
          batteryPercent: 82,
        },
        "demo",
      );
    };
    createDemoReading();
    demoTimer.current = window.setInterval(createDemoReading, 2_500);
  };

  const stopDemo = () => {
    if (demoTimer.current) window.clearInterval(demoTimer.current);
    demoTimer.current = undefined;
    setPhase((currentPhase) => (currentPhase === "demo" ? "idle" : currentPhase));
    setStatusMessage("Use Chrome or Edge on this PC and keep the band close.");
  };

  const heartRateValues = useMemo(
    () => history.flatMap((reading) => (reading.heartRate === undefined ? [] : [reading.heartRate])).slice(-40),
    [history],
  );
  const isBusy = phase === "selecting" || phase === "connecting" || phase === "authenticating";
  const isActive = phase === "connected" || phase === "demo";
  const updated = current?.observedAt
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(
        new Date(current.observedAt),
      )
    : "Waiting for first reading";

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="MedDesk home">
          <span className="brand-mark">M</span>
          <span>MedDesk</span>
        </a>
        <div className="topbar-status">
          <span className={`server-dot ${serverOnline ? "online" : ""}`} />
          Local server {serverOnline ? "online" : "offline"}
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">MI BAND 5 · PRIVATE PC MONITOR</p>
          <h1>Your pulse, closer at hand.</h1>
          <p className="hero-copy">
            Connect your band directly to this computer. Readings stay on your local Node server and update here in real time.
          </p>
        </div>
        <div className="privacy-note">
          <ShieldIcon />
          <span><strong>Local by design</strong>Your auth key never leaves this browser tab.</span>
        </div>
      </section>

      <section className="dashboard-grid">
        <aside className="connect-panel card">
          <div className="panel-heading">
            <span className="step-number">01</span>
            <div>
              <p className="eyebrow">DEVICE ACCESS</p>
              <h2>Connect your band</h2>
            </div>
          </div>

          <label htmlFor="auth-key">Zepp auth key</label>
          <div className="key-input">
            <input
              id="auth-key"
              type={showKey ? "text" : "password"}
              value={authKey}
              onChange={(event) => setAuthKey(event.target.value)}
              placeholder="0x · 32 hexadecimal characters"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="text-button" onClick={() => setShowKey((visible) => !visible)}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <p className="field-help">Use the key from get-band-key.ps1 after pairing in Zepp Life with a Zepp email account. Do not paste your password here.</p>

          {phase === "connected" ? (
            <button className="primary-button disconnect" type="button" onClick={() => void disconnect()}>
              Disconnect band
            </button>
          ) : (
            <button className="primary-button" type="button" disabled={isBusy || authKey.trim().length < 32} onClick={() => void connect()}>
              <BluetoothIcon />
              {isBusy ? "Connecting…" : "Connect Mi Band 5"}
            </button>
          )}
          <button className="secondary-button" type="button" onClick={phase === "demo" ? stopDemo : () => void startDemo()}>
            {phase === "demo" ? "Pause preview" : "Preview with demo data"}
          </button>

          <div className={`connection-state state-${phase}`}>
            <span className="pulse-dot" />
            <span><strong>{phaseLabels[phase]}</strong>{statusMessage}</span>
          </div>

          <div className="checklist">
            <p>Before connecting</p>
            <div><CheckIcon /> Wear the band snugly</div>
            <div><CheckIcon /> Close Zepp Life and Gadgetbridge</div>
            <div><CheckIcon /> Turn on Windows Bluetooth</div>
          </div>
        </aside>

        <section className="vitals-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">LIVE OVERVIEW</p>
              <h2>Today at a glance</h2>
            </div>
            <div className={`live-badge ${isActive ? "active" : ""}`}><span />{isActive ? "LIVE" : "STANDBY"}</div>
          </div>

          <div className="metrics-grid">
            <article className="metric-card heart-card">
              <div className="metric-top"><HeartIcon /><span>HEART RATE</span></div>
              <div className="metric-value">{formatMetric(current?.heartRate)} <small>BPM</small></div>
              <p>{current?.heartRate ? heartRateCaption(current.heartRate) : "Waiting for a live measurement"}</p>
              <Sparkline values={heartRateValues} />
            </article>

            <article className="metric-card">
              <div className="metric-top"><StepsIcon /><span>STEPS</span></div>
              <div className="metric-value">{formatMetric(current?.steps)}</div>
              <div className="progress"><span style={{ width: `${Math.min(((current?.steps ?? 0) / 10_000) * 100, 100)}%` }} /></div>
              <p>{current?.steps ? `${Math.round((current.steps / 10_000) * 100)}% of a 10,000 step goal` : "Today’s total from the band"}</p>
            </article>

            <article className="metric-card compact">
              <div className="metric-top"><RouteIcon /><span>DISTANCE</span></div>
              <div className="metric-value">{formatDistance(current?.distanceMeters)} <small>KM</small></div>
              <p>Calculated by the band</p>
            </article>

            <article className="metric-card compact">
              <div className="metric-top"><FlameIcon /><span>ACTIVE ENERGY</span></div>
              <div className="metric-value">{formatMetric(current?.calories)} <small>KCAL</small></div>
              <p>Today’s estimate</p>
            </article>

            <article className="metric-card compact battery-card">
              <div className="metric-top"><BatteryIcon /><span>BATTERY</span></div>
              <div className="metric-value">{formatMetric(current?.batteryPercent)} <small>%</small></div>
              <div className="battery-track"><span style={{ width: `${current?.batteryPercent ?? 0}%` }} /></div>
            </article>

            <article className="metric-card compact sleep-card">
              <div className="metric-top"><MoonIcon /><span>SLEEP</span></div>
              <div className="metric-value muted">— <small>HRS</small></div>
              <p>Available after activity-history sync</p>
            </article>
          </div>

          <div className="last-reading">
            <span>LAST READING</span>
            <strong>{updated}</strong>
            <span className="source-pill">{current?.source === "demo" ? "DEMO" : current ? "MI BAND" : "NO DATA"}</span>
          </div>
        </section>
      </section>

      <footer>
        <span>MedDesk Band Monitor</span>
        <span>Wellness data only · not a medical device</span>
      </footer>
    </main>
  );
}

function formatMetric(value?: number) {
  return value === undefined ? "—" : new Intl.NumberFormat().format(value);
}

function formatDistance(value?: number) {
  return value === undefined ? "—" : (value / 1000).toFixed(2);
}

function heartRateCaption(value: number) {
  if (value < 60) return "Below the usual resting range";
  if (value <= 100) return "Within the usual resting range";
  return "Above the usual resting range";
}

function BluetoothIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 5 4.5-5 4.5 5 4.5-5 4.5V3Zm0 9L7.5 7.8M12 12l-4.5 4.2" /></svg>; }
function ShieldIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.7 2.9 8 7 10 4.1-2 7-5.3 7-10V6l-7-3Z" /><path d="m9.3 12 1.8 1.8 3.8-4" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3 3L15 7" /></svg>; }
function HeartIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 5.8a5.3 5.3 0 0 0-7.5 0L12 7.1l-1.3-1.3a5.3 5.3 0 1 0-7.5 7.5L12 22l8.8-8.7a5.3 5.3 0 0 0 0-7.5Z" /></svg>; }
function StepsIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4c1.3 2 1.2 4.1-.3 6.2-1.6 2.2-4 3.1-5.7 2.3C1.7 11.8 2 9 3.7 6.8 5.3 4.7 7.8 2.5 9 4Zm6 7c1.3 2 1.2 4.1-.3 6.2-1.6 2.2-4 3.1-5.7 2.3-1.3-.7-1-3.5.7-5.7 1.6-2.1 4.1-4.3 5.3-2.8Z" /></svg>; }
function RouteIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h3a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" /></svg>; }
function FlameIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3s1 4-2 6c-2 1.4-3 3-3 5a4 4 0 0 0 8 0c0-1.2-.4-2.5-1.2-3.7C18 12 20 15 19 18a7 7 0 0 1-13.4-4C6.3 9 10 7 13 3Z" /></svg>; }
function BatteryIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="16" height="10" rx="2" /><path d="M21 10v4M6 10h7v4H6z" /></svg>; }
function MoonIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" /></svg>; }
