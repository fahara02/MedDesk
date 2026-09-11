# MedDesk doctor workspace

Latest studio and bridge status: [delivery matrix](PROGRESS.md).
Remote deployment and Windows installer: [deployment guide](deploy/README.md).
The updated local instance is at `http://localhost:8790/`.

A local React and Node.js workspace for prescription drafting, source review,
consultation history and real Mi Band 5 observations.

## Run

Requires Node.js 22.16+ and npm. Band monitoring requires Windows with Bluetooth,
Windows PowerShell 5.1, an initialized Mi Band 5 and its authentication key.

```powershell
npm ci
npm run build
npm start
```

Open `http://localhost:8787/#vitals`. The current development session is serving
the updated application at **http://localhost:8789/#vitals** because earlier
servers occupy 8787 and 8788. `PORT` selects a different local port.

For frontend development, `npm run dev` serves React on 5173 and proxies `/api`
to the development server on 8787.

## Live band data

Configure these private values in the root `.env`:

```dotenv
BLUETOOTH_ADDRESS=your-band-address
Key=your-32-hexadecimal-character-band-key
```

Turn off the phone's Bluetooth temporarily, wear the band and click **Start live
monitoring** in Patient vitals. The server starts one hidden Windows Bluetooth
collector, authenticates using the local key and reads activity totals and
battery every **10 seconds**. Heart rate uses band notifications; the latest
new notification is published on each 10-second tick with its original timestamp.
Absent notifications never become new heart-rate readings. GATT operations are
serial; an operation that exceeds the interval delays the next poll without
creating overlapping Bluetooth requests.

The server persists each observation before broadcasting it over **SSE** at
`GET /api/events`. React subscribes with `EventSource`, loads saved observations
on connection/reconnection, deduplicates by reading ID and closes its stream on
unmount. Browsers neither open Bluetooth nor receive the authentication key.
Slow SSE clients are disconnected to prevent an unbounded server output queue.

Monitoring continues if the browser closes. **Stop live monitoring** releases
the band. Multiple browser tabs share the same server collector. A Bluetooth
error stops monitoring and shows the error; use Start to retry. Saved values
retain their observation times. A live badge requires an active stream, a
measuring server session and an observation within 25 seconds.

Endpoints: `GET /api/band/status`, `POST /api/band/start`, `POST /api/band/stop`.
Start returns immediately with HTTP 202; status and readings arrive over SSE.

Sleep is separate recorded history, fetched from the configured Zepp account
through `POST /api/sleep/sync`; `GET /api/sleep` returns the last saved result.
It is not polled every 10 seconds. The actual account query on September 12,
2026 returned no sleep records for the last seven days. The UI shows unavailable
sleep rather than inventing a duration. See [PAIRING.md](PAIRING.md) for setup.

## Prescription workspace

- Author and print unsigned prescriptions with exact medication text and Bangla.
- Save and reopen consultations, inspect revisions and reject stale edits.
- Import PDF/PNG/JPEG originals and manually review transcription.
- Search medicine CSVs under `data/` for product identity; no dose defaults.
- Attach selected real band observations to an identified visit explicitly.
- Inspect source hashes, local completeness checks and capability coverage.

Native `.lps` reading/writing, OCR, cryptographic signatures and pharmacy
transactions are **not connected**. The new rich editor supports image signature
placement and Windows TTS. Qwen/RAG is wired, but provider calls currently fail
under the account's free-tier-only quota restriction. The coverage page
maps the broader plan; it is not a claim that those capabilities are complete.
Prescription JSON export and printing do not produce a signed `.lps` file.

This is a single-user local demo bound to `127.0.0.1`, without multiuser access
control or encrypted clinical storage. Real observations and consultations stay
under ignored `data/`. Zepp sleep sync and key extraction contact the provider
only when requested. `.env`, keys, tokens and health records must stay out of Git.

## Verify

```powershell
npm run typecheck
npm test
npm run build
npm run test:integration
.\scripts\test-band-config.ps1
```

The opt-in physical check subscribes read-only to a running monitoring server
and verifies real SSE events update the React DOM at approximately 10-second
intervals. It never creates readings:

```powershell
$env:MEDDESK_LIVE_URL = 'http://127.0.0.1:8789'
npm run test --workspace @meddesk/web -- src/live-band.test.tsx
Remove-Item Env:MEDDESK_LIVE_URL
```

This DOM test is not a visual browser inspection.
