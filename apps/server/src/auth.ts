import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";

const COOKIE = "__Host-meddesk-session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key));
});

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}

interface Session {
  expiresAt: number;
  streams: Set<Response>;
  timer: ReturnType<typeof setTimeout>;
}

/** Single-workspace sessions. Restarting the server requires a fresh sign-in. */
export class WorkspaceAuth {
  private sessions = new Map<string, Session>();
  private attempts = new Map<string, { count: number; until: number }>();
  private pending = 0;
  private salt = Buffer.alloc(0);
  private passwordKey = Buffer.alloc(0);

  constructor(
    private origin: string | undefined,
    private username: string | undefined,
    passwordHash: string | undefined,
    private sessionMs = SESSION_MS,
  ) {
    if (!origin) return;
    if (!username || username.length > 128 || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash || ""))
      throw new Error("Remote mode requires a login username and a scrypt password hash.");
    const [, salt, key] = passwordHash!.split(":");
    this.salt = Buffer.from(salt, "hex");
    this.passwordKey = Buffer.from(key, "hex");
  }

  private sessionKey(request: Request): string {
    const tokens = (request.get("Cookie") || "").split(";")
      .map(value => value.trim()).filter(value => value.startsWith(COOKIE + "="));
    const token = tokens.length === 1 ? tokens[0].slice(COOKIE.length + 1) : "";
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? hashToken(token) : "";
  }

  private session(request: Request): Session | undefined {
    const key = this.sessionKey(request), session = this.sessions.get(key);
    if (session && session.expiresAt <= Date.now()) { this.revoke(key); return; }
    return session;
  }

  private revoke(key: string) {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    clearTimeout(session.timer);
    for (const stream of session.streams) {
      stream.end("event: auth-expired\ndata: {}\n\n");
    }
  }

  private clearCookie(response: Response) {
    response.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  }

  readonly middleware: RequestHandler = async (request, response, next) => {
    const safe = request.method === "GET" || request.method === "HEAD";
    if (request.path === "/api/auth/session" && safe) {
      const session = this.origin ? this.session(request) : undefined;
      response.json({ enabled: !!this.origin, authenticated: !this.origin || !!session,
        ...(session ? { username: this.username, expiresAt: session.expiresAt } : {}) });
      return;
    }
    if (!this.origin) return next();
    if (request.method === "POST" && ["/api/bridge/enroll", "/api/bridge/uplink"].includes(request.path)) return next();
    if (request.path === "/api/health" && safe) return next();
    if (!safe && request.get("Origin") !== this.origin) {
      response.status(403).json({ error: "This request came from another website. Reload MedDesk and try again." });
      return;
    }
    if (request.path === "/api/auth/logout" && request.method === "POST") {
      this.revoke(this.sessionKey(request));
      this.clearCookie(response);
      response.json({ authenticated: false });
      return;
    }
    if (request.path === "/api/auth/login" && request.method === "POST") {
      // The validated proxy replaces this header; never enable unrestricted trust proxy.
      const ip = request.get("X-Forwarded-For") || request.socket.remoteAddress || "unknown";
      const now = Date.now();
      for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
      const attempt = this.attempts.get(ip) || { count: 0, until: now + WINDOW_MS };
      if (attempt.count >= 10 || this.pending >= 2 || (!this.attempts.has(ip) && this.attempts.size >= 1024)) {
        response.setHeader("Retry-After", String(Math.max(1, Math.ceil((attempt.until - now) / 1000))));
        response.status(429).json({ error: "Too many sign-in attempts. Please try again later." });
        return;
      }
      attempt.count++;
      this.attempts.set(ip, attempt);
      const { username, password } = request.body || {};
      if (typeof username !== "string" || username.length > 128 || typeof password !== "string" || password.length > 256) {
        response.status(401).json({ error: "The username or password is incorrect." }); return;
      }
      this.pending++;
      let passwordKey: Buffer;
      try { passwordKey = await derive(password, this.salt); }
      finally { this.pending--; }
      const validPassword = timingSafeEqual(passwordKey, this.passwordKey);
      const validUsername = timingSafeEqual(Buffer.from(hashToken(username)), Buffer.from(hashToken(this.username!)));
      if (!validPassword || !validUsername) {
        response.status(401).json({ error: "The username or password is incorrect." }); return;
      }
      this.attempts.delete(ip);
      this.revoke(this.sessionKey(request));
      while (this.sessions.size >= 128) this.revoke(this.sessions.keys().next().value!);
      const token = randomBytes(32).toString("base64url"), key = hashToken(token);
      const expiresAt = Date.now() + this.sessionMs;
      const timer = setTimeout(() => this.revoke(key), this.sessionMs);
      timer.unref();
      this.sessions.set(key, { expiresAt, timer, streams: new Set() });
      response.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(this.sessionMs / 1000)}`);
      response.json({ enabled: true, authenticated: true, username: this.username, expiresAt });
      return;
    }
    // The application shell and bundled assets contain no patient data.
    if (safe && !/^\/(api|downloads)(\/|$)/i.test(request.path)) return next();
    if (!this.session(request)) {
      this.clearCookie(response);
      response.status(401).json({ error: "Please sign in to your workspace." }); return;
    }
    next();
  };

  watchStream(request: Request, response: Response) {
    const session = this.session(request);
    if (!session) return;
    session.streams.add(response);
    response.once("close", () => session.streams.delete(response));
  }

  close() { for (const key of this.sessions.keys()) this.revoke(key); }
}
