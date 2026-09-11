# MedDesk project state

This file records the implementation state needed to continue the project on another computer. Credentials, the Mi Band authentication key, and collected health readings are deliberately excluded from Git.

## What is implemented

- A React and Vite dashboard connects directly to a Xiaomi Mi Band 5 through Chrome or Edge Web Bluetooth.
- The browser performs the Huami authentication-key handshake and reads continuous heart rate, steps, distance, calories, and battery.
- An Express server validates readings, appends them to `data/readings.jsonl`, serves the production dashboard, and broadcasts updates with server-sent events.
- The dashboard includes demo data so the UI and server can be checked without a band.
- `get-band-key.ps1` wraps the vendored `huami-token` utility without putting the account password on the command line.

## Important decisions

- The browser owns the Bluetooth connection. The Node.js server stores and distributes readings; it does not open Bluetooth itself.
- Mi Band 5 must first be bound through Zepp Life using a direct Zepp email/password account. Xiaomi and social-login credentials do not work with the current key-extraction route.
- The 16-byte band auth key stays in the browser tab and is never posted to the server.
- Do not unpair or factory-reset the band after extracting its key because that invalidates the key.
- Sleep history is not implemented because it requires proprietary activity-history synchronization and classification.

## Continue on the Bluetooth laptop

Install Node.js 22 or newer, Git, current Chrome or Edge, Python, and `uv`. Then run:

```powershell
git clone https://github.com/fahara02/MedDesk.git
cd MedDesk
npm ci
Copy-Item .env.example .env
```

Fill `.env` with the direct Zepp account as described in `PAIRING.md`, then extract the key:

```powershell
.\get-band-key.ps1
```

For development, run `npm run dev` and open `http://127.0.0.1:5173`. For the production build, run:

```powershell
npm run build
npm start
```

Then open `http://localhost:8787`, close Zepp Life or disable the phone's Bluetooth temporarily, paste the auth key, and click **Connect Mi Band 5**. The browser must be allowed to open its device chooser.

## Last known state

- Type checking, unit tests, and production builds passed on the original PC.
- The local API, file persistence, and event stream were exercised successfully.
- Physical Mi Band testing remained pending because the original PC exposed no Bluetooth radio to Windows even though Bluetooth services and inbox drivers were present.
- On the laptop, first confirm Windows shows a Bluetooth toggle and Chrome or Edge can open the Web Bluetooth chooser. Continue with the troubleshooting section in `PAIRING.md` if the band is not listed.

## Current continuation — 12 September 2026, E:\MedDesk

- Windows now exposes a Realtek Bluetooth Adapter and a Microsoft Bluetooth LE
  Enumerator, both status OK. The original no-radio finding no longer describes
  this machine. Physical Mi Band authentication and real readings remain unverified.
- Dependencies were installed from the lockfile. No `.env` or band auth key was
  present when this continuation started. Enter the key only into the local app;
  never request it in chat or commit it.
- Connection attempts now clean up after rejection, cancellation, discovery
  failure, timeout and link loss. All GATT work is serialized; periodic polling
  schedules the next request only after the previous one completes.
- Summary packets no longer resend an old heart rate with a fresh timestamp.
  The display retains the heart rate's actual observation time. Demo data has a
  DEMO overview badge. No automatic resting-range interpretation is displayed.
- Regression tests use a simulated GATT device and the known AES test vector;
  these prove the client state handling, not physical device compatibility.
- Browser automation found no connected browser; Chrome is installed but was
  stopped and lacked the ChatGPT extension. Manual Chrome/Edge use remains possible.
- The full objective remains a doctor-facing app with prescription writing, AI
  interaction and patient vitals. The current app is still the band monitor;
  prescribing, patient/encounter attribution and the AI workflow remain to build
  after the first physical band connection. Do not mark the full objective complete.
- Validation in this continuation: 17 browser-client unit tests and two server
  tests pass; the TypeScript/Vite production build passes. The built server was
  started on port 8787 and `/api/health` returned `ok: true`; `/` returned HTTP 200.
  Recheck the process and endpoint on resume. No physical reading has been claimed.

## Security notes

- Never commit `.env`, a band auth key, `data/readings.jsonl`, or account credentials.
- The vendored `huami-token` logging was adjusted so authentication payloads containing credentials or tokens are not written to debug logs.
- Rotate any account password or access token that has previously appeared in terminal or chat output.
