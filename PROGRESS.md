# Delivery matrix — September 12, 2026

Studio and desktop/remote requirements are separate from the paused native
project's 95 engineering tasks. This matrix does not alter that task denominator.

| Requested outcome | State | Evidence / remaining work |
|---|---|---|
| Full-width studio and side tools | Implemented | Tiptap canvas, formatting, tables; built and DOM-tested. Visual browser QA unavailable. |
| Document save/reopen | Verified locally | Exact doses, Bangla, tables and signature images pass save tests. |
| All drug files seeded | Verified locally | 9,763 products / 14 CSVs; zero import errors; SQLite index populated. |
| Drug retrieval | Verified locally | FTS5, selected-product context, source hashes/URLs and actual nonempty excerpts. |
| Working AI assistant | Verified remotely | Requested backend model responds successfully; HTTPS application test retrieved eight sources, cited source/document and preserved `0.500`. Model names are hidden in the UI. |
| TTS | Verified remotely | Bengali synthesis returned a valid 156,450-byte WAV through the hosted API; exact source-text hash matched. |
| Speech-to-text and audio samples | Updated and deployed | Fixed recording bar keeps a red Stop outside the scrolling settings. Simulated 36-second capture/stop/transcribe passes. Microphone settings and sample comparison are collapsed. Prior hosted English/Bengali accuracy limitations remain. |
| Dictation placement on prescription | Deployed; integration tested | Named patient, clinical, observation and individual medicine fields; exact preview; Add/Replace; stable medicine identity across reordering; removed destinations retain text. Save, exact decimals/Bengali and undo pass. Visual browser inspection remains unavailable. |
| App and prescription branding | Deployed | Original MedDesk M restored in app/login; LCH on prescription only. Doctor name retained; no invented registration. |
| Bangladesh prescription layout | Deployed | Patient strip at top, doctor header, left notes/right numbered Rx, footer signature. Editor and print share layout; visual pagination unverified. |
| Prescription language selection | Deployed | English default; selectable English/Bangla labels and speech defaults; authored text unchanged. |
| Model comparison | Text screening complete; audio pending | All 165 catalog entries classified; 92 text candidates tested, 14 responded and passed three synthetic checks. This is not a clinical quality ranking. |
| Doctor signature placement | Deployed | Supplied white-background image verified over authenticated HTTPS and placed in Dr. Kamal Uddin's draft footer. Existing signatures and other doctors retained; certificate signing separate. |
| Genuine `.lps` saving | Unfinished | Native implementation gaps remain; unsigned-draft versus authorized-export decision requested. See [export boundary](NATIVE-EXPORT.md). |
| Installable Windows bridge | Website download verified | Reopen `/#install-band`; computer name and valid enrollment code retained within the tab. Installer explains code versus band key. Full hosted executable matches extraction-verified package. Fresh-PC installation unverified. |
| Desktop → HTTPS → SSE | Synthetic integration verified | Actual Windows daemon tested for TLS upload failure, stable-ID retry and remote stop. Physical remote verification pending. |
| Multiple PCs and offline behavior | Verified locally | Enrollment, revocation, per-PC selector, bounded durable queue and historical timestamps. |
| Physical local Bluetooth dashboard | Verified | Server 8791; actual SSE-to-React test passed after graceful handover. |
| Remote site on 72.62.69.41 | Deployed and verified | https://medesk.lifeplusbd.tech; Nginx HTTPS, protected dashboard, healthy private Docker service, drug seed, TTS, assistant and SSE verified. |
| Branded sign-in page | Deployed and verified | React login replaces the browser prompt; existing credentials retained. Cookie sessions, sign-out, rate limiting and SSE revocation verified over HTTPS. |

Next: receive the owner's audio sample and compare recognition accuracy, enroll
a real PC and verify remote physical readings, and resolve the native `.lps`
writer decisions and implementation gaps. Hosting does not complete native export.
