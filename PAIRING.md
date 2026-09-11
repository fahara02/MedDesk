# Mi Band 5 setup on Windows

The current band is paired through **Zepp**. The Windows server now owns
Bluetooth; the React page subscribes to server-sent events and needs no browser
Bluetooth chooser or pasted key.

## Account and key

Keep the band's existing phone-app pairing. If it displays **Pair first**,
complete the phone-app initialization and confirm on the band before trying
authenticated measurements. Windows pairing alone does not complete that step.

The owner has already completed this setup and supplied a working key. For a
fresh installation, put the account actually holding the band in `.env`:

```dotenv
ACCOUNT_METHOD=amazfit
EMAIL=your-zepp-account@example.com
ZEPP_PASSWORD=your-zepp-password
BLUETOOTH_ADDRESS=your-band-address
Key=your-32-hexadecimal-character-band-key
```

`amazfit` is the bundled extractor's name for the Zepp route; the wrapper also
accepts `zepp`. `PASSWORD` belongs to Gmail and is never used for Zepp or Xiaomi.
`XIAOMI_PASSWORD` is used only when explicitly selecting the Xiaomi route.
Signing into Gmail does not authenticate either provider.

When a key needs extracting, use the existing `uv` installation:

```powershell
uv sync --project huami-token --frozen --no-dev
.\get-band-key.ps1 -AccountMethod zepp
```

The wrapper reads the selected provider password internally, without putting it
on the command line. Match the returned Bluetooth address to your band and copy
the key into `.env`. Do not send it in chat. `Key`, `BAND_AUTH_KEY` and `AUTH_KEY`
are supported by the native reader, with an optional `0x` prefix.

Do not unpair or factory-reset the band after extracting its key.

## Monitor

1. Enable Windows Bluetooth. The current laptop has a working Realtek adapter.
2. Turn off phone Bluetooth to release the band's existing phone connection.
3. Wear the initialized band with its sensor touching the wrist.
4. Run `npm run build`, then `npm start`.
5. Open `http://localhost:8787/#vitals` and choose **Start live monitoring**.

The current session uses **http://localhost:8789/#vitals**. The server opens
Windows GATT, authenticates and gathers observations every 10 seconds. Allow
about 30 seconds for the first heart-rate sample. Keep the server running;
closing the page does not stop monitoring. Choose **Stop live monitoring** to
release the band before reconnecting a phone.

**LIVE** requires fresh data from the current measuring session. Old values
remain labelled saved or stale. Battery is device status and is displayed
separately from heart rate, steps, distance and active calories.

## Sleep

**Sync sleep history** fetches recorded sleep from the configured Zepp account
using `EMAIL` and `ZEPP_PASSWORD`. Bluetooth monitoring does not need the account
password after the key has been obtained. Sleep synchronization is a separate
action, not a 10-second cloud login loop.

The verified account query returned zero records for the last seven days; this
does not establish that the band contains no sleep data. Direct Bluetooth sleep
history synchronization/classification is not implemented. Missing data is
shown as unavailable, never as zero hours or inferred sleep.

## If monitoring fails

- Check that the phone and any older browser session have released the band.
- Check the local Bluetooth address and key without exposing them.
- Read the status on Patient vitals, then use Start to retry after the problem
  is corrected. A failed connection releases its Windows services.
- Keep the band close and check wrist contact if activity arrives without pulse.
- A battery read alone does not prove application authentication or human vitals.

`read-band-battery.ps1` remains a one-shot battery diagnostic.
`read-band-vitals.ps1 -Seconds 35` is a bounded authenticated diagnostic. Do not
run either concurrently with the active server collector.
