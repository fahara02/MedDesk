import { useEffect, useRef, useState } from "react";
import { api } from "../lib/clinic";
import { workspaceFetch } from "../lib/session";
import type { useBand } from "../lib/useBand";

interface Device {
  id: string;
  label: string;
  revoked: boolean;
  lastSeenAt: string | null;
}
export function DesktopBridges({ band }: { band: ReturnType<typeof useBand> }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [label, setLabel] = useState("");
  const [invite, setInvite] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const download = useRef<AbortController | null>(null);
  useEffect(() => () => download.current?.abort(), []);
  const getInstaller = async () => {
    if (downloading) return;
    const abort = new AbortController(); download.current = abort;
    setDownloading(true); setError("");
    try {
      const response = await workspaceFetch("/downloads/MedDesk-Bridge-Setup.exe", { signal: abort.signal });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to download the installer." : "The installer could not be downloaded. Please try again.");
      const blob = await response.blob();
      if (blob.size < 1024 || response.headers.get("content-type")?.includes("text/html")) throw new Error("The server did not return the Windows installer.");
      const href = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = href; link.download = "MedDesk-Bridge-Setup.exe";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
      if (!abort.signal.aborted) setDownloaded(true);
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    finally { if (!abort.signal.aborted) setDownloading(false); }
  };
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api<{ devices: Device[] }>("/api/bridge/devices")
        .then((data) => {
          if (active) setDevices(data.devices || []);
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const enroll = async () => {
    setBusy(true);
    setError("");
    try {
      setInvite(
        await api("/api/bridge/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/bridge/devices/" + band.bridgeId, { method: "DELETE" });
      setDevices((items) => items.filter((item) => item.id !== band.bridgeId));
      band.selectBridge("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="desktop-bridges">
      <h3>Connect your Mi Band to this website</h3>
      <p className="helper">Install once on a Windows 10 or 11 PC with Bluetooth. Keep that PC near the band; readings are forwarded every 10 seconds while you are signed in to Windows.</p>
      <div className="bridge-setup-step">
        <h4>1. Download and open the installer</h4>
        <a className="button primary full" href="/downloads/MedDesk-Bridge-Setup.exe" download="MedDesk-Bridge-Setup.exe" aria-disabled={downloading} onClick={event => { event.preventDefault(); void getInstaller(); }}>
          {downloading ? "Downloading installer…" : "Download Windows installer"}
        </a>
        <p className="helper">Windows x64 · Includes the runner · No Node.js or Python installation needed.</p>
        {downloaded && <p role="status">Download ready. Open <strong>MedDesk-Bridge-Setup.exe</strong> from your browser’s Downloads to install.</p>}
      </div>
      <div className="bridge-setup-step">
      <h4>2. Link this computer</h4>
      <label className="field"><span>Server address</span><input readOnly value={window.location.origin} onFocus={event => event.target.select()} /></label>
      <label className="field"><span>Computer name</span><input value={label} onChange={event => setLabel(event.target.value)} placeholder="Consultation room PC" maxLength={80} /></label>
      <button className="button secondary full" disabled={busy || !label.trim()} onClick={() => void enroll()}>Create enrollment code</button>
      {invite && <div className="notice">
        <p>Paste this one-use code into the installer:</p>
        <code style={{ overflowWrap: "anywhere", userSelect: "all" }}>{invite.code}</code>
        <button className="button small" onClick={() => {
          if (!navigator.clipboard) { setError("Select and copy the code above."); return; }
          void navigator.clipboard.writeText(invite.code).then(() => setCopied(true)).catch(() => setError("Select and copy the code above."));
        }}>{copied ? "Code copied" : "Copy enrollment code"}</button>
        <p>Expires {new Date(invite.expiresAt).toLocaleTimeString()}. Create a new code if it expires.</p>
      </div>}
      <p className="helper">In the installer, enter the band’s Bluetooth address and authentication key. The key stays encrypted on that PC.</p>
      </div>
      <div className="bridge-setup-step">
      <h4>3. Select your PC and start monitoring</h4>
      <label>
        Readings from
        <select
          aria-label="Readings computer"
          value={band.bridgeId}
          onChange={(event) => band.selectBridge(event.target.value)}
        >
          <option value="">{band.native?.available && !band.bridgeId ? "This server's Bluetooth" : "Select an installed computer"}</option>
          {devices
            .filter((d) => !d.revoked)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
        </select>
      </label>
      {!devices.some(device => !device.revoked) && <p className="helper">Waiting for your first computer. This list refreshes every 10 seconds after installation.</p>}
      {band.bridgeId && <><p className="helper">{band.native?.message || "Checking the selected computer…"}</p><button className="button primary full" disabled={!band.native?.available || band.native.running} onClick={() => void band.startNative()}>Start monitoring</button></>}
      {band.bridgeId && (
        <button
          className="button subtle full"
          disabled={busy}
          onClick={() => void revoke()}
        >
          Revoke this computer's access
        </button>
      )}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      </div>
    </section>
  );
}
