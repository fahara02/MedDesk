import { useEffect, useState } from "react";
import { api } from "../lib/clinic";
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
      <h3>Desktop Bluetooth bridge</h3>
      <label>
        Readings from
        <select
          aria-label="Readings computer"
          value={band.bridgeId}
          onChange={(event) => band.selectBridge(event.target.value)}
        >
          <option value="">This server's Bluetooth</option>
          {devices
            .filter((d) => !d.revoked)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
        </select>
      </label>
      <p className="helper">
        Install the bridge on the Windows PC paired with your band. It sends
        readings to this website while you are signed in to Windows.
      </p>
      <a
        className="button secondary full"
        href="/downloads/MedDesk-Bridge-Setup.exe"
      >
        Download Windows installer
      </a>
      <label>
        Computer name
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Consultation room PC"
          maxLength={80}
        />
      </label>
      <button
        className="button secondary full"
        disabled={busy || !label.trim()}
        onClick={() => void enroll()}
      >
        Create enrollment code
      </button>
      {invite && (
        <div className="notice">
          <p>Enter this one-use code in the installer:</p>
          <code style={{ overflowWrap: "anywhere", userSelect: "all" }}>
            {invite.code}
          </code>
          <p>Expires {new Date(invite.expiresAt).toLocaleTimeString()}.</p>
        </div>
      )}
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
    </section>
  );
}
