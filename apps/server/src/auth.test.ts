import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword, WorkspaceAuth } from "./auth.js";
import { remoteAccess } from "./remote-access.js";

const origin = "https://meddesk.example", secret = "isolated-test-proxy-secret-not-for-production";
const credentials = { username: "test-doctor", password: "synthetic-password" };
const headers = { "X-MedDesk-Proxy": secret, Origin: origin, "Content-Type": "application/json" };
const passwordHash = await hashPassword(credentials.password);

async function fixture(run: (base: string) => Promise<void>, sessionMs?: number) {
  const auth = new WorkspaceAuth(origin, credentials.username, passwordHash, sessionMs);
  const app = express();
  app.use(remoteAccess(origin, secret), express.json(), (_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); }, auth.middleware);
  app.get("/api/events", (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.write("event: ready\ndata: {}\n\n"); auth.watchStream(request, response);
  });
  app.get("/api/consultations", (_request, response) => response.json({ consultations: ["private fixture"] }));
  app.get("/downloads/test.exe", (_request, response) => response.send("installer"));
  app.get("/", (_request, response) => response.send("public login shell"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`); }
  finally { auth.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const post = (base: string, route: string, body = {}, extra = {}) => fetch(base + route, {
  method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body),
});

test("login shell has no challenge; proxy headers alone never unlock clinical data", async () => {
  await fixture(async base => {
    const shell = await fetch(base, { headers });
    assert.equal(shell.status, 200); assert.equal(shell.headers.get("www-authenticate"), null);
    const status = await fetch(base + "/api/auth/session", { headers });
    assert.deepEqual(await status.json(), { enabled: true, authenticated: false });
    for (const route of ["/api/consultations", "/api/events", "/downloads/test.exe", "/API/consultations"]) {
      const response = await fetch(base + route, { headers });
      assert.equal(response.status, 401); assert.equal(response.headers.get("www-authenticate"), null);
    }
    assert.equal((await post(base, "/api/auth/login", credentials, { Origin: "https://bad.example" })).status, 403);
    assert.equal((await post(base, "/api/auth/login", credentials, { Origin: "" })).status, 403);
    assert.equal((await post(base, "/api/auth/login", credentials, { "X-MedDesk-Proxy": "wrong" })).status, 401);
    assert.equal((await post(base, "/api/auth/login", { ...credentials, password: "wrong" })).status, 401);
    assert.equal((await post(base, "/api/auth/login", { ...credentials, username: "wrong" })).status, 401);
  });
});

test("session cookies unlock APIs and SSE; logout closes streams and prevents replay", async () => {
  await fixture(async base => {
    const login = await post(base, "/api/auth/login", credentials);
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie")!;
    for (const flag of ["__Host-meddesk-session=", "HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(setCookie.includes(flag));
    const result = await login.json();
    assert.equal(result.authenticated, true); assert.equal(result.username, credentials.username);
    assert.ok(!JSON.stringify(result).includes(credentials.password));
    const Cookie = setCookie.split(";")[0];
    const signedHeaders = { ...headers, Cookie };
    assert.equal((await fetch(base + "/api/consultations", { headers: signedHeaders })).status, 200);
    const stream = await fetch(base + "/api/events", { headers: signedHeaders });
    const reader = stream.body!.getReader();
    await reader.read();
    assert.equal((await post(base, "/api/auth/logout", {}, { Cookie, Origin: "https://bad.example" })).status, 403);
    const logout = await post(base, "/api/auth/logout", {}, { Cookie });
    assert.equal(logout.status, 200); assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
    assert.match(new TextDecoder().decode((await reader.read()).value), /auth-expired/);
    assert.equal((await reader.read()).done, true);
    assert.equal((await fetch(base + "/api/consultations", { headers: signedHeaders })).status, 401);
    assert.equal((await fetch(base + "/api/auth/session", { headers: signedHeaders }).then(r => r.json())).authenticated, false);
  });
});

test("sessions expire and successful reauthentication rotates the previous token", async () => {
  await fixture(async base => {
    const first = await post(base, "/api/auth/login", credentials);
    const Cookie = first.headers.get("set-cookie")!.split(";")[0];
    const second = await post(base, "/api/auth/login", credentials, { Cookie });
    const replacement = second.headers.get("set-cookie")!.split(";")[0];
    assert.notEqual(Cookie, replacement);
    assert.equal((await fetch(base + "/api/consultations", { headers: { ...headers, Cookie } })).status, 401);
    assert.equal((await fetch(base + "/api/consultations", { headers: { ...headers, Cookie: replacement } })).status, 200);
    await delay(1200);
    assert.equal((await fetch(base + "/api/consultations", { headers: { ...headers, Cookie: replacement } })).status, 401);
  }, 1000);
});

test("repeated failures are throttled and remote mode refuses missing credentials", async () => {
  assert.throws(() => new WorkspaceAuth(origin, undefined, undefined), /requires a login/);
  await fixture(async base => {
    for (let i = 0; i < 10; i++) assert.equal((await post(base, "/api/auth/login", { ...credentials, password: "wrong" })).status, 401);
    const blocked = await post(base, "/api/auth/login", credentials);
    assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  });
});
