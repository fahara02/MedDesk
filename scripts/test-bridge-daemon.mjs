import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

test(
  "Windows daemon delivers over TLS, retains failed uploads, retries stable IDs, and stops on remote command",
  { skip: process.platform !== "win32", timeout: 55000 },
  async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const directory = await mkdtemp(path.join(os.tmpdir(), "meddesk-daemon-"));
    let child, server;
    try {
      await mkdir(path.join(directory, "app"));
      const fixture = `param([switch]$Continuous,[switch]$ControlStdin)
@{event='status';phase='measuring';message='Synthetic collector fixture'} | ConvertTo-Json -Compress
@{event='reading';reading=@{source='band';heartRate=73;observedAt=[DateTime]::UtcNow.AddMinutes(-5).ToString('o');deviceName='Synthetic daemon test'}} | ConvertTo-Json -Depth 4 -Compress
$null=[Console]::ReadLine()
`;
      await writeFile(
        path.join(directory, "app", "read-band-vitals.ps1"),
        fixture,
      );
      const cert = path.join(directory, "cert.pem"),
        key = path.join(directory, "key.pem");
      const config = path.join(directory, "openssl.cnf");
      await writeFile(config, "[req]\ndistinguished_name=dn\n[dn]\n");
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-config",
          config,
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "1",
          "-subj",
          "/CN=localhost",
          "-addext",
          "subjectAltName=DNS:localhost",
        ],
        { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
      );
      const token = "synthetic-desktop-credential";
      let failedOnce = false,
        finished = false;
      const attempts = [];
      server = https.createServer(
        { key: await readFile(key), cert: await readFile(cert) },
        async (request, response) => {
          assert.equal(request.url, "/api/bridge/uplink");
          assert.equal(request.headers.authorization, "Bearer " + token);
          let text = "";
          for await (const chunk of request) text += chunk;
          const body = JSON.parse(text);
          response.setHeader("Content-Type", "application/json");
          if (body.readings.length) {
            attempts.push(body.readings);
            if (!failedOnce) {
              failedOnce = true;
              response.writeHead(503);
              response.end("{}");
              return;
            }
            finished = true;
          }
          response.end(
            JSON.stringify({
              accepted: body.readings.map((row) => row.id),
              desiredRunning: !finished,
            }),
          );
        },
      );
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      child = spawn(process.execPath, ["apps/server/dist/bridge-daemon.js"], {
        cwd: root,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          MEDDESK_BRIDGE_DIR: directory,
          MEDDESK_BRIDGE_ORIGIN: `https://localhost:${server.address().port}`,
          MEDDESK_BRIDGE_TOKEN: token,
          MEDDESK_BRIDGE_ID: crypto.randomUUID(),
          NODE_EXTRA_CA_CERTS: cert,
        },
      });
      const deadline = Date.now() + 45000;
      let state;
      while (Date.now() < deadline) {
        assert.equal(child.exitCode, null, "Daemon exited unexpectedly");
        try {
          state = JSON.parse(
            await readFile(path.join(directory, "status.json"), "utf8"),
          );
        } catch {}
        if (finished && state?.queued === 0 && state?.running === false) break;
        await delay(250);
      }
      assert.equal(finished, true);
      assert.equal(state?.queued, 0);
      assert.equal(state?.running, false);
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts[0], attempts[1]);
      assert.ok(
        Date.now() - Date.parse(attempts[1][0].reading.observedAt) > 240000,
      );
      await writeFile(path.join(directory, "stop"), "stop");
      const done = once(child, "exit");
      await Promise.race([
        done,
        delay(5000).then(() => {
          throw new Error("Daemon did not stop.");
        }),
      ]);
      assert.equal(child.exitCode, 0);
    } finally {
      if (child && child.exitCode === null) {
        const done = once(child, "exit");
        child.kill();
        await done;
      }
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
