import { useState, type FormEvent } from "react";
import { practice } from "../lib/branding";
import { Icon } from "./Icon";

export function LoginPage({ onLogin, checking, connectionError, onRetry, message }: {
  onLogin: (username: string, password: string) => Promise<void>;
  checking: boolean;
  connectionError: string;
  onRetry: () => void;
  message: string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || checking || connectionError) return;
    setBusy(true); setError("");
    try { await onLogin(username.trim(), password); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story" aria-label="MedDesk doctor workspace">
      <a className="login-wordmark" href="/" aria-label="MedDesk home"><span className="brand-logo">m<span>+</span></span>MedDesk</a>
      <div className="login-story-content">
        <span className="login-eyebrow">YOUR CLINICAL WORKSPACE</span>
        <h1>More time for <br />the person <br /><em>in front of you.</em></h1>
        <p>Prescriptions, patient records and connected vitals.<br />A considered space for your daily practice.</p>
        <div className="login-workflow" aria-label="Workspace tools">
          <div><Icon name="studio" /><span>Write prescriptions</span></div>
          <div><Icon name="history" /><span>Review patient records</span></div>
          <div><Icon name="vitals" /><span>Connect your devices</span></div>
        </div>
      </div>
      <div className="login-story-footer"><span className="login-monogram">MK</span><div><strong>{practice.clinician}</strong><span>Doctor workspace</span></div></div>
    </section>
    <section className="login-panel" aria-labelledby="login-title">
      <a className="brand login-app-brand" href="/" aria-label="MedDesk"><span className="brand-logo">m<span>+</span></span><span>meddesk<span className="brand-sub">CLINICAL WORKSPACE</span></span></a>
      <div className="login-form-wrap">
        <span className="login-welcome">WELCOME BACK</span>
        <h2 id="login-title">Sign in to MedDesk</h2>
        <p className="login-subtitle">Your practice, all in one place.</p>
        {message && <p className="login-message" role="status">{message}</p>}
        {checking ? <p className="login-message" role="status">Connecting to your workspace…</p> : connectionError ? <div className="login-error" role="alert">{connectionError}<button type="button" onClick={onRetry}>Try again</button></div> : null}
        <form onSubmit={submit} aria-label="Sign in" aria-busy={busy}>
          <label htmlFor="login-username">Username</label>
          <input id="login-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={128} required value={username} onChange={event => setUsername(event.target.value)} placeholder="Enter your username" disabled={busy || checking} />
          <label htmlFor="login-password">Password</label>
          <div className="login-password-field">
            <input id="login-password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" maxLength={256} required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" disabled={busy || checking} aria-describedby={error ? "login-error" : undefined} />
            <button type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>{visible ? "Hide" : "Show"}</button>
          </div>
          {error && <p id="login-error" className="login-error" role="alert">{error}</p>}
          <button className="login-submit" type="submit" disabled={busy || checking || !!connectionError}>{busy ? "Signing in…" : "Sign in"}<Icon name="arrow" size={19} /></button>
        </form>
        <p className="login-help"><Icon name="evidence" size={16} />Access is reserved for your practice team.</p>
      </div>
      <footer className="login-panel-footer"><span>{practice.name}</span><span>MedDesk · Doctor workspace</span></footer>
    </section>
  </main>;
}
