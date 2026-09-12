# MedDesk demo LPS

The owner explicitly approved relaxed, unsigned export for their personal demo
on September 12, 2026, then requested a working Save as LPS on `/#demo`.
This host implementation is separate from the paused native writer. It neither
changes its emission gates nor counts as an original native task closure.

## Working behavior

The sample page downloads a real binary `.lps` file and a one-page PDF. The
studio starts new browser workspaces with the fictional Ayesha Rahman example,
retains existing recovered drafts, and exports edits to demo LPS. Open LPS
reopens the document as a new record. Save as PDF invokes the browser print
dialog for the current rendered prescription; choose Save as PDF as destination.
The sample page's PDF and LPS always describe its displayed static sample.

## Experimental byte contract

`apps/server/src/demo-lps.ts` writes the eight-byte LPS signature, then HEAD and
CORE chunks using 12-byte prefixes, little-endian lengths and CRC32C trailers.
Both codecs and chunk flags are zero. HEAD is 32 bytes: version 1.0, private
profile `0x4d440001`, jurisdiction BD, compact draft, two chunks, exact decoded
payload sum, NON_PRODUCTION bit 7 and document kind 1. No SIGN exists.

CORE is a deterministic CBOR map with text keys: `format: meddesk-demo/1`,
`environment: sample`, `status: unsigned-draft`, and `draft`, the complete
validated consultation including its rich document when present. Only text,
integer, boolean, null, array and text-keyed map values are admitted. Original
clinical strings are retained verbatim; no numbers or dose semantics are inferred.

**This is an experimental CORE contract, not the normative integer-keyed
CORE-SCHEMA/proto mapping.** Private profile allocation does not waive the
normative CORE contract or establish conformance. The LPS framing is implemented;
native semantic interoperability, public-reader acceptance, signed issuance,
clinical authorization and native writer completion are not claimed. UI labels
identify this as a private, unsigned demo format for MedDesk. `nativeLps` remains
false; the artifact manifest reports `demoLps: true` separately.

The reader accepts only this exact profile/version and framing, requires
canonical CBOR, bounds files at 1 MiB, traversal at 20,000 nodes and nesting at
40 levels, then applies the existing consultation/document validator. Unknown
profiles, extra chunks, trailing data, bad CRC, malformed encodings and production
content are refused. CRC detects corruption; it does not authenticate an author.
Linked source files and device reading IDs are refused. Import creates a new
consultation ID/revision and retains fictional status. An image signature in an
edited document is display content and supplies no digital signature authority.

## Evidence

`npm run demo:build` rebuilds the static pair and their SHA-256 manifest.
`npm run test:demo` checks the published binaries, fixture round-trip, exact
decimal/Unicode/rich text, every byte corruption, every truncation, trailing
data, size refusal, private framing and non-demo/evidence rejection.
Web integration checks edit/download/decode, PDF invocation, file import and
corruption refusal, unsaved-work protection, existing-draft recovery and the
populated fresh default. No completed native schema validation is implied.
