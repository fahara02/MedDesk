# Dictation controls and prescription placement — September 12, 06:37 Dhaka

Deployed to https://medesk.lifeplusbd.tech as `20260912-dictation-fields`.

| User problem | Delivered behavior |
|---|---|
| Recording status says Stop, but the button is buried | Start becomes a large red Stop in a fixed control area above the scrolling tool body. Timer and input meter stay beside it. Settings and sample comparison are collapsed. |
| Dictation lands at an arbitrary cursor | Select the exact prescription field: patient details at the top, left-column notes/examination/diagnosis, plan below medicines, or a specific medicine's dose, frequency, duration and other fields. |
| Existing text could be changed without a clear preview | Preview shows the selected field's result. Add preserves existing text; Replace is explicit. Undo restores the previous content. |
| Medicine movement or removal could redirect text | Resolve the current medicine ID and field at insertion time. Removed or ambiguous fields refuse insertion and retain review text. |

Workflow: **Dictate → Prescription field → Start dictation → Stop dictation →
review/edit → Add to [field]**. Select Replace explicitly when correcting a whole
field. This routes one reviewed text block to a chosen field; it does not infer
multiple clinical fields from an unrestricted paragraph.

Validation: 25 server + 58 web + two HTTP integration checks passed (**85 total**),
one physical web test skipped. The recording regression reaches 36 seconds and
checks Stop in the fixed control region, microphone choice, transcription and
explicit application. Editor tests cover the wrong cursor, reordered medicines,
removed/duplicate fields, exact `0.500 mg`, Bengali and newlines, literal markup,
preserved formatting, save/projection and undo. The original tests went red before
the new controls and destination selector were implemented.

The HTTP checks initially hit their five-second startup window during concurrent
checks; both passed unchanged on the separate rerun. Local and remote production
builds passed. All four required native gates passed; architecture retained two
existing warnings and caught all 87 mutation fixtures. Native code stayed paused.

Actual HTTPS verification confirms the new JS/CSS match local build hashes,
transcription is available, authentication is enforced, the private white signature
is retained, the catalog has 9,763 products, and authenticated SSE works. The
application and speech containers are healthy, using about 93 MiB and 368 MiB.
[Machine-readable evidence](dictation-fields-deployment-20260912.json).

No browser connection was available for screenshot or pixel-level inspection.
The owner reported actual captured bytes; this release did not independently
transcribe the owner's microphone. The earlier English repetition and unreliable
Bengali test remain accuracy limitations.

Native project count remains **57/95 (60%)**, **38 remaining**. This web release
does not close any native task.
