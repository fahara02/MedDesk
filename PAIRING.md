# Pair a Mi Band 5 with MedDesk on Windows

There are three separate links in this setup:

1. **Band → its existing phone app and account:** establishes the band-specific Bluetooth auth key.
2. **Mi Band 5 → Chrome/Edge on the PC:** the React app uses Web Bluetooth and that key to authenticate directly with the band.
3. **React app → local Node server:** readings are posted to the server and stored in `data/readings.jsonl`.

The Mi Band does not connect to Node directly in this build. Chrome or Edge owns the Bluetooth connection; Node owns storage and live dashboard distribution.

## What your Xiaomi account changes

The owner already uses a Xiaomi account registered with a Gmail address. Keep
that account and test the bundled extractor's Xiaomi route first. The earlier
instruction to create a new Zepp account was an assumption, not a verified
requirement for this account.

The extractor's current Xiaomi route authenticates against Xiaomi and queries
Mi Fitness bound-device records. An older band's key may be held by a different
service even when the login identity is Xiaomi. Account login success and a
returned key for the correct band are separate checks. Do not reset or unpair
the band to work around an empty device list.

## Step 1: identify the existing band and account

1. Keep the band charged and its current pairing intact.
2. Confirm the exact band model and the phone app that currently displays it.
3. Confirm which Xiaomi account that app uses. A Gmail address is an account
   identifier; the Gmail browser session is not the extractor's Xiaomi session.
4. Use the password that actually signs into Xiaomi. If Xiaomi uses Google
   sign-in instead, complete the appropriate Xiaomi account login flow before
   attempting the password-based extractor. Do not send a Gmail-only password
   to Xiaomi or a different vendor.

## Step 2: configure the existing Xiaomi account in `.env`

Open `.env` in your MedDesk checkout (currently `E:\MedDesk\.env`) and use this shape:

```dotenv
ACCOUNT_METHOD=xiaomi
EMAIL=your-xiaomi-account@example.com
XIAOMI_PASSWORD=your-xiaomi-account-password
```

`xiaomi` selects the existing Xiaomi implementation. `amazfit` is a separate
Zepp route and is not the owner's current pipeline.
If `.env` also contains Gmail's `PASSWORD`, leave it intact. The wrapper only
passes `XIAOMI_PASSWORD` to the extractor, inside its child process environment.

## Step 3: extract the Bluetooth auth key

From PowerShell in your MedDesk checkout, run:

```powershell
uv sync --project huami-token --frozen --no-dev
.\get-band-key.ps1
```

If `uv` and the package are already installed, run only `.\get-band-key.ps1`.
The native command is also available, and prompts privately for the Xiaomi
password when `--password` is omitted:

```powershell
uv run --no-sync --project huami-token huami-token --method xiaomi --email your-xiaomi-account@example.com --bt_keys
```

The result should show a MAC address and an auth key beginning with `0x`. Copy the auth key. Do not send it in chat or publish it.

If authentication fails, inspect the specific Xiaomi error and whether an
interactive verification step is required. A `401` alone does not identify the
account type. If there are no linked devices, verify the existing phone app,
account, model and device binding before selecting another extraction route.

The current account returned an interactive verification link while the utility
reported "Missing ssecurity or location in auth response". Complete the Xiaomi
check using the private link saved in `tmp/xiaomi-verification-url.txt`, then
retry the wrapper. That file is local and ignored by Git; it is not supplied
with a fresh checkout, and its link can expire.

## Step 4: prepare Bluetooth on this PC

Windows must show a Bluetooth toggle under **Settings → Bluetooth & devices**.

- If the PC has built-in Bluetooth, enable it and install the computer manufacturer's Bluetooth driver if the toggle is missing.
- If the PC has no Bluetooth hardware, connect a Windows-compatible Bluetooth 4.0 or newer USB adapter and install its driver.
- Do not add the Mi Band manually through Windows **Add device**. The MedDesk page opens the correct browser Bluetooth chooser itself.

The original PC had no Bluetooth adapter. On 12 September 2026, Windows on the
current PC reported a Realtek Bluetooth Adapter and Microsoft Bluetooth LE
Enumerator, both with status OK. Confirm the toggle and browser access locally;
the presence of the adapter alone does not prove a connection to the band.

## Step 5: start the server and dashboard

From the project folder, install dependencies and build once after cloning:

```powershell
npm ci
npm run build
```

Then start the server:

```powershell
npm start
```

Open this address in current Chrome or Edge:

```text
http://localhost:8787
```

The header should say **Local server online**. You can click **Preview with demo data** first to confirm that storage and live updates work.

## Step 6: connect the band from the dashboard

1. Temporarily turn off the phone's Bluetooth to release its connection to the band.
2. Wear the band snugly so its heart-rate sensor touches the skin.
3. Paste the `0x…` auth key into **Band auth key** on the MedDesk page.
4. Click **Connect Mi Band 5**. This click is required by browser Bluetooth security.
5. In the Chrome/Edge chooser, select **Mi Smart Band 5**, **Mi Band 5**, or the device whose name starts with `Mi`.
6. Click **Pair** or **Connect** in the chooser. Confirm on the band if it displays a check mark.
7. The status should move through **Connecting**, **Authenticating**, and **Live**. The overview badge says **CONNECTED**; this describes the link, while the heart-rate card shows the time of its last actual measurement. The green heart-rate LEDs under the band should turn on. Individual Bluetooth operations and authentication time out after 15 seconds with a retryable error.
8. Heart rate, steps, distance, calories, and battery will appear. Node saves readings locally in `data/readings.jsonl`.

**Cancel connection** releases the app's attempt. If the browser chooser remains
open, close it too; a later selection from that cancelled attempt cannot start
monitoring. A failure releases the connection before retrying. Preview mode is
labeled **DEMO** and does not prove that physical Bluetooth works.

Chrome/Edge do not need the ChatGPT extension to connect to the band. The extension
is needed only if you want the coding assistant to operate the browser for you.

The browser connection follows [Chrome's Web Bluetooth documentation](https://developer.chrome.com/docs/capabilities/bluetooth),
including user-initiated device selection, reacquiring characteristics after
disconnect, and serializing GATT operations. Mi Band 5 auth-key pairing is also
documented in [Gadgetbridge's Xiaomi device guide](https://gadgetbridge.org/gadgets/wearables/xiaomi/).

## Troubleshooting

### The browser does not list the band

- Confirm Windows now has a working Bluetooth toggle.
- Turn off the phone's Bluetooth temporarily to release its active band connection.
- On the band, use **More → Settings → Reboot**. Do not choose factory reset.
- Reload `http://localhost:8787` and click Connect again.

### Authentication is rejected

- Make sure the key is exactly 32 hexadecimal characters, with an optional `0x` prefix.
- Re-run `.\get-band-key.ps1` after every unpair or factory reset.
- Confirm the band in the browser chooser is the same band whose MAC address was printed by the extractor.

### Server is offline

- Keep the PowerShell window running after `npm start`.
- Confirm it prints `MedDesk Mi Band server listening on http://localhost:8787`.
- Close another program using port 8787, then run `npm start` again.

### Connected but no heart rate appears

- Wear the band firmly, with the sensor flat against the wrist.
- Wait 30 seconds for the first sample.
- Disconnect and reconnect once after making sure no phone app holds the Bluetooth link.
