# Voice and installer follow-up — September 12, 2026

Live release: `20260912-server-dictation` at https://medesk.lifeplusbd.tech.

| Request | Delivered | Still open |
|---|---|---|
| Voice detection fails | Microphone selector/input level; server-backed recording-to-text; optional browser recognition; explicit text insertion. | Owner microphone retry and recognition accuracy. |
| Computer-name setup appeared only once | `/#install-band` opens setup directly. Computer name and unexpired code persist within the tab; expired codes clear. | Fresh-PC installation. |
| Enrollment code versus `.env` key | Installer text explains the website-generated one-use code and separate band authentication key. | User completes pairing/enrollment on the selected PC. |
| Prescription, M branding, white e-sign and language | Prior milestone `dfbda76` retained in this deployment. | Visual browser and print pagination inspection. |

78 automated checks passed: 25 server, 51 web, two HTTP integration tests.
One physical web test was skipped. Local and remote builds passed, as did the
rebuilt installer extraction check and complete hosted executable hash check.

Actual HTTPS transcription evidence:

- English synthetic WebM returned editable text in 13.44 seconds; the source
  hash matched. It repeated one sentence, so this does not establish accuracy.
- Silence was refused with 422; malformed audio with 400.
- Bengali synthetic speech was unusable and refused with 422. Bengali recognition
  is not claimed reliable.
- No owner microphone recording was used for these checks.

[Detailed results](dictation-deployment-20260912.json).

The speech container used about 360 MiB after the probes, with a 1.5 GiB ceiling
and two CPU cores. The application used about 95 MiB. Speech has no public port,
uses temporary RAM files and retains no transcription recordings. Separate
comparison uploads remain an explicit user action.

Native project remains paused at **57/95 (60%)**, **38 remaining**. These web
releases do not add native task closures.
