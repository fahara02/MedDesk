# Delivery matrix — September 12, 2026

Studio and desktop/remote requirements are separate from the paused native
project's 95 engineering tasks. This matrix does not alter that task denominator.

| Requested outcome | State | Evidence / remaining work |
|---|---|---|
| Full-width studio and side tools | Implemented | Tiptap canvas, formatting, tables; built and DOM-tested. Visual browser QA unavailable. |
| Document save/reopen | Verified locally | Exact doses, Bangla, tables and signature images pass save tests. |
| All drug files seeded | Verified locally | 9,763 products / 14 CSVs; zero import errors; SQLite index populated. |
| Drug retrieval | Verified locally | FTS5, selected-product context, source hashes/URLs and actual nonempty excerpts. |
| Working Qwen assistant | Partial | Adapter and reviewed proposal insertion exist; provider rejects calls under free-tier-only quota. |
| TTS | Partial | Windows WAV synthesis works. Bengali voice absent; Linux needs browser/provider speech. |
| Doctor signature placement | Verified locally | Drawing/upload, insertion and persistence. Cryptographic signing remains separate. |
| Genuine `.lps` saving | Unfinished | Native writer validation/compatibility/authorization and signing integration required. |
| Installable Windows bridge | Packaged | 34 MB executable; setup/tray/autostart, DPAPI credentials; extraction check passes. Fresh-PC installation unverified. |
| Desktop → HTTPS → SSE | Synthetic integration verified | Actual Windows daemon tested for TLS upload failure, stable-ID retry and remote stop. Physical remote verification pending. |
| Multiple PCs and offline behavior | Verified locally | Enrollment, revocation, per-PC selector, bounded durable queue and historical timestamps. |
| Physical local Bluetooth dashboard | Verified | Server 8790; actual SSE-to-React test passed after graceful handover. |
| Remote site on 72.62.69.41 | Prepared, not deployed | DNS correct, protected configuration and deployment archive ready. SSH username missing; existing server proxy must be inspected. |

Next: establish SSH login, inspect existing services, deploy the protected site,
seed drug CSVs, enroll a real PC and verify remote readings. Continue Qwen quota
resolution and native `.lps` integration; hosting does not complete either feature.
