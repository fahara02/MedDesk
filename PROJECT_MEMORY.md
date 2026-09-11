# MedDesk project state

Updated September 12, 2026. Active implementation is **E:\MedDesk**. The separate
native project at E:\Projects\LabaidAI-ePrescription remains paused and was not
edited for this delivery.

## Current direction

The owner requested a full doctor-facing React workspace, then prioritized
verified physical Mi Band readings. The latest requirement is **server-owned
Bluetooth polling every 10 seconds, distributed to React through SSE**. The
browser must not own the band connection or receive the key. Do not call saved
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

The updated server runs at **http://localhost:8789/#vitals**, PID 23460 at the
time of this update. Monitoring started at 2026-09-11T20:30:56Z; recheck status
before reporting that it remains active. The configured default remains 8787.

Older servers occupy 8787 (PID 9976) and 8788 (PID 10500). An automatic policy
review rejected a combined stop/restart command for the old server without a
detailed reason. A separate port was used without killing it. The collector on
8788 was gracefully stopped through its API before starting 8789; only the
8789 server should own Bluetooth. Do not run parallel diagnostic collectors.

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

Native `.lps` read/write, OCR, provider AI, neural speech, signatures, authority
checks and pharmacy transactions remain unconnected. The 125-row showcase
coverage inventory is a product mapping, not the native 95-task completion
ledger. Never imply that printing/exporting JSON produces a signed `.lps`.
This is a single-user local demo without multiuser authentication or encrypted
clinical storage, not a completed clinical deployment.

## Working rules

Preserve local changes and the owner's `.env`. Only the main session writes
tests; do not wake the paused native lanes. All milestone commits must use sole
author and committer **fahara02 <idea3d.faruk@gmail.com>**, without coauthors or
push. Keep `.env`, all `data/`, `tmp/`, keys, tokens, readings and local build
outputs out of Git. `apps/web/src/content/coverage.json` is intentional source.

Run `npm test`, `npm run build`, `npm run test:integration`, and the credential
routing check after relevant changes. Keep the active collector running for the
owner, unless stopping it is necessary for a verified replacement or requested.
