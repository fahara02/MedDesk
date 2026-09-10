# MedDesk Mi Band 5 monitor

A local PC dashboard for a Xiaomi Mi Band 5. The React app connects to the band through Web Bluetooth in Chrome or Edge, performs the Huami auth-key handshake, and reads live heart rate plus the band's current steps, distance, calories, and battery. A Node.js server validates readings, saves them locally, and streams updates back to every open dashboard.

## Requirements

- Windows 10/11 or macOS with Bluetooth Low Energy
- Current Google Chrome or Microsoft Edge
- Node.js 22+
- A Mi Band 5 already paired once through Zepp Life
- The band's 16-byte Bluetooth auth key

Web Bluetooth requires a secure context and a click to open the device chooser. `http://localhost` is treated as secure by Chrome and Edge.

## Run it

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173` in Chrome or Edge. Paste the auth key, click **Connect Mi Band 5**, and select the band in the browser chooser.

For the complete phone, account, Windows Bluetooth, and server sequence, read [PAIRING.md](PAIRING.md).

Close Zepp Life and Gadgetbridge first because the band normally accepts one active BLE client. Keep the key private; the dashboard uses it only inside the current browser tab and never sends it to the Node server.

To test the full dashboard and server without a band, click **Preview with demo data**.

## Get the auth key on Windows

For Mi Band 5, pair through Zepp Life with a direct Zepp email/password account. Put those credentials in `.env` as shown in `.env.example`, then run the local wrapper. It reads the password internally instead of putting it in the process command line:

```powershell
.\get-band-key.ps1
```

Do not unpair or factory-reset the band after extracting the key; either action changes or invalidates it.

## Production build

```powershell
npm run build
npm start
```

Then open `http://localhost:8787`. Readings are appended to `data/readings.jsonl` and are not sent to a cloud service.

## Current scope

The live dashboard supports heart rate, steps, distance, active calories, and battery. Sleep is stored as proprietary activity-history samples on the band and needs a separate sync-and-classification module; it is marked accordingly in the UI. This project is a wellness dashboard, not a diagnostic or medical device.
