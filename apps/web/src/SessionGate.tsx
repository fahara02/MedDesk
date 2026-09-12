import { useCallback, useEffect, useRef, useState } from "react";
import App from "./App";
import { LoginPage } from "./components/LoginPage";

interface Session { enabled: boolean; authenticated: boolean; expiresAt?: number; }
async function authRequest(route: string, body?: object): Promise<Session> {
  const response = await fetch(`/api/auth/${route}`, {
    credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000),
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Sign-in is unavailable. Please try again.");
  return result;
}
function notifyOtherTabs() {
  try { localStorage.setItem("meddesk.auth-change", String(Date.now())); } catch {}
}

export default function SessionGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(true);
  const generation = useRef(0);
  const authPending = useRef(false);
  const check = useCallback(async () => {
    if (authPending.current) return;
    const current = ++generation.current;
    try {
      const result = await authRequest("session");
      if (current === generation.current) { setSession(result); setError(""); }
    } catch {
      if (current === generation.current) setError("We couldn’t connect to MedDesk. Check your connection and try again.");
    } finally { if (current === generation.current) setChecking(false); }
  }, []);
  useEffect(() => {
    void check();
    const expired = () => {
      generation.current++;
      setSession({ enabled: true, authenticated: false });
      setChecking(false); setError("");
      setMessage("Please sign in again to continue your work.");
    };
    const storage = (event: StorageEvent) => { if (event.key === "meddesk.auth-change") void check(); };
    const focus = () => { void check(); };
    window.addEventListener("meddesk:sign-in-required", expired);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", focus);
    const timer = window.setInterval(() => void check(), 60000);
    return () => {
      generation.current++; clearInterval(timer);
      window.removeEventListener("meddesk:sign-in-required", expired);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", focus);
    };
  }, [check]);
  useEffect(() => {
    if (!session?.authenticated || !session.expiresAt) return;
    const timer = window.setTimeout(() => window.dispatchEvent(new Event("meddesk:sign-in-required")), Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);
  async function login(username: string, password: string) {
    authPending.current = true;
    const current = ++generation.current;
    try {
      const result = await authRequest("login", { username, password });
      if (current === generation.current) { setSession(result); setError(""); setMessage(""); notifyOtherTabs(); }
    } finally { authPending.current = false; }
  }
  async function logout() {
    if (authPending.current) return;
    authPending.current = true;
    generation.current++;
    try {
      await authRequest("logout", {});
      sessionStorage.removeItem("meddesk.bridge.setup");
      setSession({ enabled: true, authenticated: false });
      setError(""); setMessage("You’ve signed out of your workspace."); notifyOtherTabs();
    } catch { setError("Sign-out did not complete. Check your connection and try again."); }
    finally { authPending.current = false; }
  }
  if (session?.authenticated) return <>
    {error && <div className="session-error" role="alert">{error}</div>}
    <App onLogout={session.enabled ? () => void logout() : undefined} />
  </>;
  return <LoginPage onLogin={login} checking={checking} connectionError={error} onRetry={() => { setChecking(true); void check(); }} message={message} />;
}
