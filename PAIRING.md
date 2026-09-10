# Pair a Mi Band 5 with MedDesk on Windows

There are three separate links in this setup:

1. **Mi Band 5 → Zepp Life on the phone:** creates and uploads the band-specific Bluetooth auth key.
2. **Mi Band 5 → Chrome/Edge on the PC:** the React app uses Web Bluetooth and that key to authenticate directly with the band.
3. **React app → local Node server:** readings are posted to the server and stored in `data/readings.jsonl`.

The Mi Band does not connect to Node directly in this build. Chrome or Edge owns the Bluetooth connection; Node owns storage and live dashboard distribution.

## What your Xiaomi account changes

Mi Band 5 belongs to the older Huami-made band family. Pair it through **Zepp Life**, which uses the Zepp backend. The `xiaomi` method in `huami-token` targets Xiaomi/Mi Fitness accounts and did not authenticate with the account currently in `.env`.

Use a Zepp account created with an email address and password. Do not choose **Sign in with Xiaomi**, **Sign in with Google**, or another social-login button because the key extractor needs a direct Zepp email/password login.

If your band is new and not paired yet, continue with Step 1. If you already paired it through a Xiaomi login and do not need to preserve its current history, unpair it from the vendor app, factory-reset it once, and then follow Step 1 with the Zepp account. A reset or unpair invalidates any old auth key.

## Step 1: pair the band with Zepp Life

1. Charge the Mi Band 5 and keep it within one metre of the phone.
2. On Android, install **Zepp Life** from Google Play. Do not use Mi Fitness for this band.
3. Open Zepp Life and choose **Create account** or **Sign up with email**.
4. Create a Zepp account with an email address and password, then complete email verification.
5. In Zepp Life, open **Profile → Add device → Band**.
6. Allow the requested Bluetooth and nearby-device permissions.
7. Select the Mi Band 5. Tap the check mark on the band when it asks for confirmation.
8. Wait until Zepp Life displays the band's battery and step count. Allow any offered firmware update to finish.
9. Leave the band bound to this account. Do not unpair it and do not factory-reset it again.

## Step 2: put the Zepp credentials in `.env`

Open `G:\Labaid\MedDesk\.env` and use this shape:

```dotenv
ACCOUNT_METHOD=amazfit
EMAIL=your-zepp-account@example.com
PASSWORD=your-zepp-password
```

`amazfit` is the method name used by the extractor for the Zepp backend; it is also correct for Zepp Life and Mi Band 5.

## Step 3: extract the Bluetooth auth key

From PowerShell in `G:\Labaid\MedDesk`, run:

```powershell
.\get-band-key.ps1
```

The result should show a MAC address and an auth key beginning with `0x`. Copy the auth key. Do not send it in chat or publish it.

If it says `401` or cannot find tokens, the account is still a Xiaomi/social-login account rather than a direct Zepp email/password account. Confirm that the same email/password can sign into Zepp Life directly.

If it says no linked devices, return to Zepp Life and make sure the band is visible, connected, and fully synced under that exact account.

## Step 4: prepare Bluetooth on this PC

Windows must show a Bluetooth toggle under **Settings → Bluetooth & devices**.

- If the PC has built-in Bluetooth, enable it and install the computer manufacturer's Bluetooth driver if the toggle is missing.
- If the PC has no Bluetooth hardware, connect a Windows-compatible Bluetooth 4.0 or newer USB adapter and install its driver.
- Do not add the Mi Band manually through Windows **Add device**. The MedDesk page opens the correct browser Bluetooth chooser itself.

This computer currently reports no Bluetooth adapter, so this step must be resolved before the physical connection can work.

## Step 5: start the server and dashboard

The dependencies and production build are already prepared. From the project folder, run:

```powershell
npm start
```

Open this address in current Chrome or Edge:

```text
http://localhost:8787
```

The header should say **Local server online**. You can click **Preview with demo data** first to confirm that storage and live updates work.

## Step 6: connect the band from the dashboard

1. Fully close Zepp Life and Gadgetbridge on the phone. Temporarily turning off the phone's Bluetooth is the most reliable way to release the band.
2. Wear the band snugly so its heart-rate sensor touches the skin.
3. Paste the `0x…` auth key into **Zepp auth key** on the MedDesk page.
4. Click **Connect Mi Band 5**. This click is required by browser Bluetooth security.
5. In the Chrome/Edge chooser, select **Mi Smart Band 5**, **Mi Band 5**, or the device whose name starts with `Mi`.
6. Click **Pair** or **Connect** in the chooser. Confirm on the band if it displays a check mark.
7. Wait up to 30 seconds. The status should move through **Connecting**, **Authenticating**, and **Live**. The green heart-rate LEDs under the band should turn on.
8. Heart rate, steps, distance, calories, and battery will appear. Node saves readings locally in `data/readings.jsonl`.

## Troubleshooting

### The browser does not list the band

- Confirm Windows now has a working Bluetooth toggle.
- Close Zepp Life and Gadgetbridge, and turn off the phone's Bluetooth temporarily.
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
