# MedDesk remote workspace and Windows Bluetooth bridge

Target: `https://medesk.lifeplusbd.tech` on `72.62.69.41`.

## Live deployment — September 12, 2026

The site is deployed. SSH uses `root` and the matching existing private key.
Nginx already serves other applications, so `compose.nginx.yml` publishes only
`127.0.0.1:8792`; Nginx provides HTTPS and Node provides the branded React login.
The current release is `/opt/meddesk/releases/20260912-studio-login`, linked from `/opt/meddesk/current`.
The app uses the persistent Docker volume `meddesk_clinical_data`.

Private settings live in `/opt/meddesk/shared/server.env` (0600), including the login
username and salted scrypt password hash. The old `dashboard.htpasswd` is retained
only for rollback; Nginx no longer challenges browsers. The owner's local
login copy is `E:/MedDesk/deploy/access.env`; never add it to Git. The internal
proxy header is set by `proxy-secret.conf`, not by browsers. Existing sites were
not replaced. The certificate expires December 10, 2026; Certbot's active renewal
timer and a MedDesk-specific deploy hook reload Nginx after renewal.

The healthy container was measured at about 98 MiB RAM against a 512 MiB limit.
HTTPS checks verified authenticated UI, the exact logo bytes, 9,763 products in
14 CSVs, a real assistant answer with retrieved citations, Bengali WAV generation,
SSE delivery, installer download, unauthenticated refusal and cross-origin refusal.
No local patient records or Bluetooth keys were copied. Remote physical Bluetooth
observations still require enrolling the Windows bridge.

To update after copying a verified source release and linking its private env file:
`docker compose -f deploy/compose.nginx.yml up -d --build --wait app`.
The previous application image is retained as `meddesk:pre-login-20260912` for
rollback. Preserve the shared data volume when changing releases.

```text
Mi Band 5 --Bluetooth--> Windows PC --outbound HTTPS--> MedDesk server
                                                           |
                                                     authenticated SSE
                                                           |
                                                    doctor dashboard
```

The remote server does not use its own Bluetooth adapter. Install the bridge on
each supported **Windows x64 PC** with a Bluetooth LE adapter. The user must remain
signed in, the PC awake and online, and the band within range. The current collector
supports Mi Band 5, not arbitrary bands or macOS/Linux PCs. Pair in Windows first,
release the phone connection, and supply that band's authentication key locally.

## Deploy

1. Point the DNS A record `medesk.lifeplusbd.tech` to `72.62.69.41`. Remove an
   unrelated AAAA record if it would direct browsers elsewhere. Confirm the SSH
   account and the server's existing proxy before changing its services. The public
   SSH key identifies a matching local private key; it is not itself a login secret.
2. Build locally: `npm ci`, `npm run build`, then
   `powershell -NoProfile -File scripts/package-bridge.ps1`. Run the documented
   tests. Copy source and the `releases/` installer to a dedicated `/opt/meddesk`
   directory, excluding `.env`, local credentials, clinical `data/`, Git, caches,
   `node_modules`, and build scratch files. `scripts/package-deployment.ps1` makes
   this allowlisted archive.
3. Create private `deploy/server.env` and `deploy/access.env` in the source checkout.
   Put `MEDDESK_LOGIN_USER` and `MEDDESK_LOGIN_PASSWORD` in `access.env`, then run
   `npm run build` and `node scripts/configure-login.mjs` to add a salted password
   hash to `server.env`. Never copy the plaintext password into source or browser
   configuration. Use one generated 32-byte random proxy secret for Node and the
   proxy. Restrict private files to the deployment account (0600 on Linux).

   `server.env`:
   ```dotenv
   MEDDESK_PUBLIC_ORIGIN=https://medesk.lifeplusbd.tech
   MEDDESK_PROXY_SECRET=<random secret>
   MEDDESK_LOGIN_USER=<doctor login>
   MEDDESK_PASSWORD_HASH=scrypt:<salt hex>:<key hex>
   ```
   `proxy.env`:
   ```dotenv
   MEDDESK_PROXY_SECRET=<same random secret>
   ```
4. If ports 80 and 443 are available, run
   `docker compose -f deploy/compose.yml up -d --build`. Caddy obtains HTTPS
   certificates after DNS reaches this server. If a reverse proxy already serves
   other sites, add an equivalent virtual host with the internal proxy header;
   **do not replace it or occupy its ports**. The Node port must stay private.
5. Sign in through the HTTPS website and verify the health page, UI, and SSE.
   Create an enrollment code in Vitals, install the bridge, select that PC in the
   dashboard, and verify physical readings. Do not call a build a live deployment.

Only the enrollment and uplink POST routes bypass the doctor's session login:
enrollment requires a random single-use code expiring in ten minutes, and uplink
requires a revocable desktop bearer credential. The login shell, logo, bundled
assets, session status and health endpoint are public; clinical APIs, SSE and
installer downloads require a server session. Node additionally requires the
internal proxy secret in remote mode and an exact same-origin header on browser
mutations. Login sets a 12-hour HttpOnly, Secure, SameSite=Strict host-only cookie;
the server stores only its token hash in memory. Logout immediately revokes that
session and closes its SSE connections. Server restarts require signing in again.
Failed login attempts are limited to ten per IP per fifteen minutes, with two
concurrent password checks and bounded session/limiter memory. Reverse proxies
must overwrite `X-Forwarded-For`. A missing login configuration refuses startup.
Existing browser draft recovery remains local and resumes after sign-in.
The deployment is a
single-workspace demo; it does not implement tenant isolation or individual doctor
roles. Do not expose the current unprotected local configuration to the internet.

For rollback, restore the previous Nginx Basic Auth configuration before starting
the older application image. That image does not enforce session authentication.

Implementation references: [Node scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
and [cookie attributes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

## Install and operate the desktop bridge

Download `MedDesk-Bridge-Setup.exe` from Vitals. Setup asks for server URL, enrollment
code, band address and band key. It bundles Node; no Python, npm, developer tools,
administrator account or separate Node install is needed. The executable is currently
unsigned. Its SHA-256 is included in `releases/` for transfer verification.

Setup installs under `%LOCALAPPDATA%\MedDeskBridge`, restricts that directory to the
current user and SYSTEM, encrypts credentials with Windows DPAPI CurrentUser, and
adds Start-menu and login-startup shortcuts. It runs as the logged-in user to reuse
that user's Windows Bluetooth context. The system tray provides dashboard, status,
start, stop and exit actions. It restarts a failed daemon process; the daemon retries
Bluetooth connections and uploads with bounded backoff. Exit before updating setup.

The collector runs serial ten-second reads. Uploads are serial and have an eight-second
timeout. Readings queue in local SQLite when offline, retaining their actual observation
timestamps. Acknowledged rows are removed; retries retain stable IDs, including across
server restart. Each enrollment has its own queue. At 30,000 pending readings the
collector stops rather than dropping measurements. Local queued health data is protected
by user-specific directory permissions, but the SQLite contents are not encrypted.
Only credentials use DPAPI; do not describe the queue as encrypted.

Each dashboard selects one computer. Device IDs accompany observations and explicit
patient assignment remains required. Delayed uploads do not become fresh measurements.
Start/stop commands arrive at the next heartbeat; revocation stops an online bridge
when it next contacts the server. Network failure can delay delivery of a stop command.
An enrollment code does not transfer a Bluetooth key to the server.

For removal, exit the tray app and run
`%LOCALAPPDATA%\MedDeskBridge\app\uninstall.ps1`, then revoke the device in Vitals.
This removes credentials and autostart, retaining offline readings for recovery.
It does not delete clinical records or unrelated application files.

## Existing studio limits when hosted

The React document editor, local consultation persistence, medicine catalog and retrieval
index can run on Linux. Seed only the intended drug CSV files into the clinical data
volume; never copy the local patient directory as a drug seed. Windows-generated speech
is unavailable on Linux; the Docker image installs eSpeak NG for offline Bengali and
English synthesis, with browser voices also selectable. Qwen needs
working server-side provider credentials and quota. The requested `qwen3.8-max`
now responds successfully; many older models still hit the account's free-tier-only
restriction. Signed native `.lps` export still needs native writer
validation and authorization; hosting does not complete that feature.

For hosted Qwen configuration, set `MEDDESK_QWEN_API_KEY`,
`MEDDESK_QWEN_BASE_URL` and `MEDDESK_QWEN_MODEL` in the private `server.env`.
These override file-based configuration and work without the Windows LUNA file.
Use the standard DashScope compatible-mode endpoint and an account with model quota;
the Token Plan endpoint is deliberately refused. Alternatively mount a private
LUNA-format env file and point `MEDDESK_LUNA_ENV` to its container path. Never
include these secrets in a source archive or the Windows installer.

## Offline Bengali speech

The local Windows workspace uses eSpeak NG 1.52.0 built from its pinned source
archive with the existing MinGW/CMake/Ninja toolchain. Reproduce it with
`powershell -NoProfile -File scripts/setup-speech.ps1`. No system installer or
voice registration is used. Source, licenses and build outputs stay under ignored
`runtime/speech-source/`; the app detects that executable and data directory.
Override them using `MEDDESK_ESPEAK_EXECUTABLE` and `MEDDESK_ESPEAK_DATA_PATH`
when using a different installation. Text is sent over stdin, never shell arguments.
The synthesized WAV retains a source-text hash and is discarded in the UI when
the document changes. This is an offline synthetic voice, not a neural voice;
medication pronunciation still needs human review.

Upstream code and license remain in the source archive:
[eSpeak NG 1.52.0](https://github.com/espeak-ng/espeak-ng/tree/1.52.0),
[GPL license](https://github.com/espeak-ng/espeak-ng/blob/1.52.0/COPYING).

Protocol references: [Windows GATT client](https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/gatt-client),
[Caddy streaming proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
