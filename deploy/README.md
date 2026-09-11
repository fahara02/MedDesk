# MedDesk remote workspace and Windows Bluetooth bridge

Target: `https://medesk.lifeplusbd.tech` on `72.62.69.41`.

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
3. On a Linux server with Docker Compose, create `deploy/server.env` and
   `deploy/proxy.env`, readable only by the deployment account. Use one generated
   32-byte random proxy secret in both files. Generate the dashboard password hash
   with Caddy's interactive `caddy hash-password` command. Store the resulting hash
   in single quotes in the Compose env file so dollar signs remain literal.

   `server.env`:
   ```dotenv
   MEDDESK_PUBLIC_ORIGIN=https://medesk.lifeplusbd.tech
   MEDDESK_PROXY_SECRET=<random secret>
   ```
   `proxy.env`:
   ```dotenv
   MEDDESK_LOGIN_USER=<doctor login>
   MEDDESK_PASSWORD_HASH='<Caddy password hash>'
   MEDDESK_PROXY_SECRET=<same random secret>
   ```
4. If ports 80 and 443 are available, run
   `docker compose -f deploy/compose.yml up -d --build`. Caddy obtains HTTPS
   certificates after DNS reaches this server. If a reverse proxy already serves
   other sites, add an equivalent authenticated virtual host to that proxy;
   **do not replace it or occupy its ports**. The Node port must stay private.
5. Sign in through the HTTPS website and verify the health page, UI, and SSE.
   Create an enrollment code in Vitals, install the bridge, select that PC in the
   dashboard, and verify physical readings. Do not call a build a live deployment.

Only the enrollment and uplink POST routes bypass the doctor's proxy login:
enrollment requires a random single-use code expiring in ten minutes, and uplink
requires a revocable desktop bearer credential. All other pages and APIs require
the dashboard login. Node additionally requires the internal proxy secret in remote
mode, and rejects browser mutations from other origins. The deployment is a
single-workspace demo; it does not implement tenant isolation or individual doctor
roles. Do not expose the current unprotected local configuration to the internet.

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
is unavailable on Linux; browser speech depends on installed browser voices. Qwen needs
working server-side provider credentials and quota. The current account's free-tier-only
restriction rejected live calls. Signed native `.lps` export still needs native writer
validation and authorization; hosting does not complete that feature.

Protocol references: [Windows GATT client](https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/gatt-client),
[Caddy streaming proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
