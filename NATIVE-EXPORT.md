# Native .lps export boundary

Checked September 12, 2026 against the paused native tree at
`E:/Projects/LabaidAI-ePrescription`. This records the decision and implementation
dependencies for the studio's requested Save `.lps`; it does not redefine JSON
export or image-signature placement as a native document.

## The decision requested

The format's verification table in `core_plan/spec/LPS-FORMAT-SPEC.md` recognizes
**Unsigned / draft** when no `SIGN` chunk exists, with a prominent warning and
watermarked rendering. However, `core_plan/spec/SPEC-WRITE.md` section 3 requires
the public writer to have validated, compatibility-checked, signed and authorized
state before `lpsw_emit` succeeds. Handling an imported unsigned file does not
automatically authorize a writer to issue one.

The pending question is whether the studio should additionally export explicitly
unsigned drafts, or wait for authorized digital signing before any `.lps` export.
An unsigned draft API would be a deliberate addition to the writer contract;
the existing authorized-emission gate would remain intact. No decision has been
inferred from silence or from signature-image placement.

## Work required whichever option is selected

1. Bind the writer constructor to production generated CORE metadata. The present
   `lpsw_new` initializes state without a production schema binding. Private
   `lpsw_model_bind` accepts a descriptor but explicitly forbids substituting a
   development schema for production metadata.
2. Implement production model validation and floor compatibility. Repository
   search finds declarations for `lpsw_validate` and `lpsw_check_compat`, not their
   implementations. Private `lpsw_builder_validated`/`lpsw_builder_checked` are
   internal producer commits, not permission for the host to supply a green report.
3. Map authored studio content into supported native fields. Retain original
   medication text and exact numbers; never infer dose units, route, clinical
   facts or semantic identities. Unsupported content must be preserved through
   a specified representation or reported before export. A JSON blob with a
   different filename does not satisfy this step.
4. Run the native writer, open resulting bytes with a fresh native reader, and
   compare all supported authored values. Test missing fields, corruption,
   unsupported content and exact Unicode/decimal preservation. Existing private
   writer fixtures are not proof of the public application route.

## If authorized signing is required

Complete `lpsw_authorize` and its reader/policy integration. The declaration exists
but the implementation is absent. Supply real signing/trust material with the
required roles and authority evidence. A pasted signature image supplies none of
that evidence. Do not synthesize a trusted doctor identity to make export succeed.

## If unsigned drafts are approved

Specify and implement a separate draft-emission operation in the native writer.
It must require structurally valid CORE, exact draft status and compatible framing;
it must not grant an authorization report or change the signed writer's state
requirements. Readback must report unsigned/draft and rendering must visibly mark
that status. The owner decision addresses this export policy; it does not by itself
complete validation, schema binding, document mapping or round-trip verification.

The public writer gap is code work as well as a policy decision. Neither option
can honestly be delivered by toggling a button in React. Native lanes remain paused;
no native source or normative specification was edited during this audit.
