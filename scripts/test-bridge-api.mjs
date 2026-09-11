import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

test(
  "remote HTTP access, enrollment, authenticated SSE, retries, PC isolation and revocation",
  { timeout: 30000 },
  async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "meddesk-remote-http-"),
    );
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const base = `http://127.0.0.1:${port}`,
      secret = "synthetic-proxy-secret-for-isolated-tests-only";
    let child, stream;
    const proxy = { "X-MedDesk-Proxy": secret };
    async function start() {
      child = spawn(process.execPath, ["apps/server/dist/index.js"], {
        cwd: root,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          MEDDESK_DATA_DIR: directory,
          MEDDESK_LUNA_ENV: path.join(directory, "missing.env"),
          MEDDESK_PUBLIC_ORIGIN: "https://medesk.lifeplusbd.tech",
          MEDDESK_PROXY_SECRET: secret,
        },
      });
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(base + "/api/health")).ok) return;
        } catch {}
        await delay(50);
      }
      throw new Error("Remote test server did not start.");
    }
    async function stop() {
      if (child && child.exitCode === null) {
        const done = once(child, "exit");
        child.kill();
        await done;
      }
    }
    async function request(
      route,
      body,
      headers = proxy,
      expected = 200,
      method = body === undefined ? "GET" : "POST",
    ) {
      const response = await fetch(base + route, {
        method,
        headers: { ...headers, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(response.status, expected, route);
      return response.json();
    }
    try {
      await start();
      await request("/api/readings", undefined, {}, 401);
      await request("/api/bridge/invites", { label: "Test PC" }, {}, 401);
      await request(
        "/api/bridge/invites",
        { label: "Test PC" },
        { ...proxy, Origin: "https://unrelated.invalid" },
        403,
      );
      const invite = await request(
        "/api/bridge/invites",
        { label: "Synthetic remote test PC" },
        proxy,
        201,
      );
      const device = await request(
        "/api/bridge/enroll",
        { code: invite.code },
        {},
        201,
      );
      await request("/api/bridge/enroll", { code: invite.code }, {}, 401);
      await request("/api/bridge/uplink", { readings: [] }, {}, 401);
      await request(
        "/api/consultations",
        undefined,
        { Authorization: "Bearer " + device.token },
        401,
      );
      const authorization = { Authorization: "Bearer " + device.token };
      const query = "?bridgeId=" + device.id;
      const response = await fetch(base + "/api/events" + query, {
        headers: proxy,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /text\/event-stream/);
      stream = response.body.getReader();
      let events = "";
      async function until(marker) {
        const timeout = AbortSignal.timeout(4000);
        while (!events.includes(marker)) {
          const result = await Promise.race([
            stream.read(),
            new Promise((_, reject) =>
              timeout.addEventListener(
                "abort",
                () => reject(new Error("SSE timed out")),
                { once: true },
              ),
            ),
          ]);
          if (result.done) throw new Error("SSE closed");
          events += new TextDecoder().decode(result.value);
        }
      }
      await until("event: ready");
      const observedAt = new Date(Date.now() - 120_000).toISOString();
      const id = crypto.randomUUID();
      const body = {
        status: {
          running: true,
          phase: "measuring",
          startedAt: new Date().toISOString(),
        },
        readings: [
          {
            id,
            reading: {
              source: "band",
              heartRate: 76,
              observedAt,
              deviceName: "Synthetic HTTP fixture",
            },
          },
        ],
      };
      const acknowledgment = await request(
        "/api/bridge/uplink",
        body,
        authorization,
      );
      assert.deepEqual(acknowledgment.accepted, [id]);
      await until("event: reading");
      const readings = (await request("/api/readings" + query)).readings;
      assert.equal(readings.length, 1);
      assert.equal(readings[0].observedAt, observedAt);
      assert.equal(readings[0].bridgeId, device.id);
      assert.equal((await request("/api/readings")).readings.length, 0);
      await stream.cancel();
      stream = undefined;
      await stop();
      await start();
      await request("/api/bridge/uplink", body, authorization);
      assert.deepEqual(
        (await request("/api/readings" + query)).readings,
        readings,
      );
      await request("/api/band/stop" + query, {});
      assert.equal(
        (await request("/api/bridge/uplink", { readings: [] }, authorization))
          .desiredRunning,
        false,
      );
      await request(
        "/api/bridge/devices/" + device.id,
        undefined,
        proxy,
        200,
        "DELETE",
      );
      await request("/api/bridge/uplink", { readings: [] }, authorization, 401);
      const devices = await request("/api/bridge/devices");
      assert.equal(devices.devices[0].revoked, true);
      assert.ok(!JSON.stringify(devices).includes(device.token));
    } finally {
      await stream?.cancel();
      await stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
