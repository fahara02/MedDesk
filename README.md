# MedDesk Mi Band 5 monitor

A local PC dashboard for a Xiaomi Mi Band 5. The React app connects to the band through Web Bluetooth in Chrome or Edge, performs the Huami auth-key handshake, and reads live heart rate plus the band's current steps, distance, calories, and battery. A Node.js server validates readings, saves them locally, and streams updates back to every open dashboard.

## Requirements

- Windows 10/11 or macOS with Bluetooth Low Energy
- Current Google Chrome or Microsoft Edge
- Node.js 22+
- A Mi Band 5 with its existing vendor pairing intact
- The band's 16-byte Bluetooth auth key

Web Bluetooth requires a secure context and a click to open the device chooser. `http://localhost` is treated as secure by Chrome and Edge.

## Run it

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173` in Chrome or Edge. Paste the auth key, click **Connect Mi Band 5**, and select the band in the browser chooser.

For the complete phone, account, Windows Bluetooth, and server sequence, read [PAIRING.md](PAIRING.md).

Temporarily turn off the phone's Bluetooth to release its connection to the band.
Keep the key private; the dashboard uses it only inside the current browser tab
and never sends it to the Node server.

To test the full dashboard and server without a band, click **Preview with demo data**.

## Get the auth key on Windows

Keep the account and app already associated with your band. The owner's current
route is Xiaomi: use `ACCOUNT_METHOD=xiaomi`, the Xiaomi account email address,
and its Xiaomi password in `.env`. A Gmail address can identify the Xiaomi
account, but being signed into Gmail does not authenticate this extractor.
The wrapper reads the password internally instead of placing it on the process
command line:

```powershell
.\get-band-key.ps1
```

On a fresh checkout, prepare the bundled extractor first with
`uv sync --project huami-token --frozen --no-dev`. It queries the Xiaomi account's
bound devices; an empty result does not prove which account or app holds a
particular older band's key. Verify the band model and its existing phone app
before changing accounts. There is no need to create a Zepp account just to test
the existing Xiaomi route.

Do not unpair or factory-reset the band after extracting the key; either action changes or invalidates it.

## Production build

```powershell
npm run build
npm start
```

Then open `http://localhost:8787`. Readings are appended to `data/readings.jsonl` and are not sent to a cloud service.

## Current scope

The live dashboard supports heart rate, steps, distance, active calories, and battery. Sleep is stored as proprietary activity-history samples on the band and needs a separate sync-and-classification module; it is marked accordingly in the UI. This project is a wellness dashboard, not a diagnostic or medical device.
