# MedDesk project state

Updated September 12, 2026. Active implementation is **E:\MedDesk**. The separate
native project at E:\Projects\LabaidAI-ePrescription remains paused and was not
edited for this delivery.

## Current direction

The active goal is a full-width prescription document editor with side tools,
TTS, LUNA-backed Qwen assistance, drug retrieval, signature placement and genuine
`.lps` saving. The owner also requested deployment to `72.62.69.41` as
`medesk.lifeplusbd.tech` and an installable Windows Bluetooth forwarding daemon.
Preserve both requirements. Native export and working Qwen calls remain unfinished.

Collection remains server/desktop-owned every ten seconds, with React using SSE.
The browser must not own Bluetooth or receive the band key. Do not call saved
measurements live. Battery is device status, not human health.

The owner subsequently paired the band through **Zepp**, superseding the earlier
Xiaomi account route. `.env` contains EMAIL, ZEPP_PASSWORD, BLUETOOTH_ADDRESS and
the working key under `Key`. Gmail's PASSWORD and XIAOMI_PASSWORD are separate;
never fall back between provider passwords. Do not print or commit credentials.
The current key was verified against the Zepp-returned key for the configured
address, and Windows GATT authentication succeeded on the physical band.

## Implemented

- React doctor workspace: consultation authoring, exact dose text, Bangla,
  unsigned print, JSON import/export, source-file review, medicine identity
  search, revision history, local completeness check and capability coverage.
- Server validation and atomic consultation/source persistence; optimistic
  revision conflicts retain the user's draft. Real observations require explicit
  patient assignment and cannot be attached to fictional consultations.
- Windows PowerShell/WinRT band helper launched and controlled by Node. Auth
  writes must use WriteWithoutResponse when the characteristic requires it;
  WriteWithResponse produced ATT error 6 on the physical band.
- Continuous heart-rate notifications, with the latest new notification emitted
  on each 10-second tick retaining its original device-notification timestamp.
  Activity totals and device battery are read every 10 seconds. GATT work is
  serial and can delay a tick; it never overlaps polls or manufactures a pulse.
- `GET /api/events` broadcasts persisted readings and collector state. React
  uses EventSource, refreshes history on reconnect, deduplicates IDs, closes the
  subscription on unmount and marks readings stale after 25 seconds. Multiple
  tabs share one collector. Closing a tab does not stop monitoring.
- POST `/api/band/start` returns 202 immediately. POST `/api/band/stop` sends a
  graceful stop to the helper and releases the band. Duplicate start returns
  409. Errors stop the collector and require a user retry. A no-output watchdog
  prevents an indefinitely stuck helper. Slow SSE subscribers are disconnected.
- Sleep history is fetched separately through Zepp's account API using Node,
  with no new Python service. GET `/api/sleep` and POST `/api/sleep/sync` expose
  the saved result and an explicit refresh. The actual query at
  2026-09-11T20:19:37Z returned **zero source days and zero sleep records** for
  the preceding seven days. Show unavailable, not zero sleep. Direct Bluetooth
  sleep-history sync/classification is still absent.

## Running local application

The updated studio runs at **http://localhost:8791/** and vitals at
**http://localhost:8791/#vitals**, PID 25080 at this update. The physical SSE-to-React
test passed after gracefully handing Bluetooth over from 8790. Recheck status
before claiming monitoring remains active. The configured default remains 8787.

Older servers occupy 8787 (PID 9976) and 8788 (PID 10500). An automatic policy
review rejected a combined stop/restart command for the old server without a
detailed reason. A separate port was used without killing it. The collector on
8788, 8789 and 8790 were gracefully stopped through their APIs; only 8791 should own
Bluetooth. Do not run parallel diagnostic collectors. New collector code also
uses a per-band Windows mutex to reject simultaneous instances.

The latest automatic approval review rejected stopping PID 16728 and restarting
port 8790 as "blocked by policy", without a detailed reason. It did not run.
The updated process was instead started on 8791; the previous collector was
stopped through its API. Do not retry process termination through another tool.

## Verification and limits

The physical SSE-to-React DOM test passed, receiving at least three distinct
heart-rate events and three activity updates while displaying LIVE. A separate
read of actual persisted activity timestamps found intervals of 10170, 9986,
9861 and 10081 ms. These checks did not post synthetic readings to the server.

Type checking and production build pass. Unit tests cover exact consultation
data, revision conflicts, source retention, band auth/cleanup, SSE React
reconnection/deduplication/staleness and sleep missingness. The HTTP integration
test uses an isolated temporary data directory and checks two SSE subscribers,
reconnect history and persistence across restart. The opt-in live React DOM
test connects read-only to the real server using `MEDDESK_LIVE_URL`. Its
fetch-stream adapter avoids mixing Node and jsdom Event classes.

The existing browser-control runtime listed no connected browsers; no visual
browser QA has been claimed. DOM tests are not visual browser inspection.

Native `.lps` read/write, OCR, cryptographic signatures, authority checks and
pharmacy transactions remain unconnected. Qwen and Windows TTS adapters now exist,
with provider limits documented below. The 125-row showcase
coverage inventory is a product mapping, not the native 95-task completion
ledger. Never imply that printing/exporting JSON produces a signed `.lps`.
This remains a single-workspace demo, not a completed clinical deployment.

## September 12 studio and desktop bridge milestone

- Tiptap replaces the form-based studio: full canvas, tools, rich text, tables,
  exact medication strings, Bangla, image signatures and matching print preview.
  Structured values are projected from the document. Contradictions, malformed
  structures and duplicate field identities are refused. Table/signature insertion
  retains patient fields; image signing is not certificate-backed signing.
- All **9,763 products in 14 CSVs** are indexed with zero import issues. Import
  handles `Description` and `Description JSON` columns and nested text. Actual
  retrieval returned eight nonempty source excerpts. Sources remain unverified.
- The standard LUNA Qwen endpoint returned 403 `AllocationQuota.FreeTierOnly` for
  configured chat and flash models. No paid settings were changed; do not silently
  fall back to Token Plan. Windows speech generated a real WAV. Windows desktop
  voices are English-only; the follow-up adds offline Bengali synthesis below.
- `releases/MedDesk-Bridge-Setup.exe` bundles Node and the WinRT collector. Per-user
  setup includes tray controls and login startup; DPAPI protects enrollment token
  and band key. Queue files have restricted permissions, not encryption. Durable
  bounded queue, stable retry IDs, backoff, remote commands, revocation and per-PC
  dashboard selection are implemented. Enrollment isolates queues by device ID.
- The actual Windows daemon TLS test used a synthetic collector: initial upload
  failure retained the reading, retry kept its identity/timestamp, acknowledgment
  drained the queue and a remote stop stopped collection. Not physical remote QA.
- `deploy/` contains Docker/Caddy HTTPS configuration with dashboard basic login
  and separate authenticated bridge routes. Node also checks an internal proxy
  secret in remote mode. Domain A lookup returns **72.62.69.41**. The supplied
  public SSH key matches `C:/Users/FHR/.ssh/id_ed25519_newage`; never print it.
  **SSH username is still missing. Nothing has been deployed or changed on that
  server.** Compose structure validates, but Docker is stopped locally; the
  container and Caddy have not been run.
- `releases/meddesk-server.tar.gz` contains allowlisted source and installer files,
  excluding `.env`, credentials and clinical data. Drug CSV seeding is separate.
- Verification: 14 server tests, 28 web tests, two HTTP integration tests, Windows
  daemon TLS test, physical 8790 React/SSE test, build/type checks and credential
  routing pass. Installer extraction check passes; fresh-PC GUI installation and
  visual browser QA remain unverified. Browser discovery found no connection.

Native `.lps` evidence: declarations exist, but public implementations of
`lpsw_validate`, `lpsw_check_compat` and `lpsw_authorize` are absent. Emission requires
validated, signed, authorized state. Do not bypass this using private compact/test
seams or disguise JSON as `.lps`. No native files were edited. The broader goal
remains active; `PROGRESS.md` records each requested outcome separately.

Follow-up: hosted Qwen variables now work even without a local LUNA file. Tests
cover complete context, refusal of oversized context instead of silent truncation,
citation validation, malformed provider responses, explicit proposal insertion
and stale/canceled answer or audio suppression. A fresh synthetic provider check
still returned 403 `AllocationQuota.FreeTierOnly` for `qwen3.6-plus`.
`NATIVE-EXPORT.md` records the native implementation gaps and the pending owner
choice: add explicitly unsigned draft export or require authorized signing first.
The format recognizes unsigned drafts, but the current writer API does not emit
them. No approval has been received for that extension and no native code changed.

Offline eSpeak NG 1.52.0 was built from checksum-pinned upstream source under
ignored `runtime/speech-source/` using existing CMake/Ninja/GCC with two build jobs.
No system installer or voice registration was used. `scripts/setup-speech.ps1`
reproduces the build. The running server lists Bengali and English offline voices.
A synthetic Bengali sentence produced a valid 160,784-byte WAV through the real
HTTP API, with the exact source-text hash. RIFF lengths are finalized for browser
playback. Human pronunciation review and visual browser QA are still outstanding.
The Docker runtime installs eSpeak NG; Docker itself has not been run here.
Follow-up verification: 17 server tests, 32 web tests and two HTTP integration
tests pass, as do build/type checks. The physical React/SSE test passed on 8791.

Automatic review also rejected an MSI extraction command and deletion of two
packaging scratch directories. Neither command ran. Source compilation replaced
the MSI route; the rejected scratch directories remain untouched. Retain the
speech runtime because the active application uses it.

## Working rules

Preserve local changes and the owner's `.env`. Only the main session writes
tests; do not wake the paused native lanes. All milestone commits must use sole
author and committer **fahara02 <idea3d.faruk@gmail.com>**, without coauthors or
push. Keep `.env`, all `data/`, `tmp/`, keys, tokens, readings and local build
outputs out of Git. `apps/web/src/content/coverage.json` is intentional source.

Run `npm test`, `npm run build`, `npm run test:integration`, and the credential
routing check after relevant changes. Keep the active collector running for the
owner, unless stopping it is necessary for a verified replacement or requested.
