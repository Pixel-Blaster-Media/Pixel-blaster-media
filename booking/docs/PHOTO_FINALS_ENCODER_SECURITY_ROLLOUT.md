# Security-patched photo encoder revision

The October 2026 production dependency audit requires sharp 0.35.5 and source-map-js 1.2.2. The JPEG encoder remains pinned to sharp 0.35.5 / libvips 8.18.7 / mozjpeg 0826579. Gallery and provisional MLS transform/profile versions advance to 2; profile IDs and rendering parameters remain unchanged. Original-byte packages remain version 1.

Derivative keys use the approved transform version, so revision 2 never aliases revision 1. The worker still rejects unexpected runtime versions and manifest/spec mismatches. No stored releases, manifests, derivatives, checkpoints or package objects are rewritten or resent.

## Required rollout

1. Pass exact candidate CI, including all PostgreSQL and photo-final native/browser/resource gates. Independently review the migration and live schema.
2. Verify the canonical production project's PHOTO_FINALS_ENABLED, PHOTO_FINALS_DISPATCH_ENABLED and PHOTO_FINALS_OPERATOR_SMOKE_ENABLED flags remain disabled. Do not enable any finals processing as part of this release.
3. Read only aggregate counts: no finished_jpeg_release.v2 releases, finals jobs, finals packages/checkpoints or gallery/MLS profile derivatives may exist. The forward migration takes write-conflicting locks and repeats this empty-state check atomically. If it fails, stop and establish an explicit historical revision policy; never repair or convert existing records automatically.
4. Apply only the reviewed forward migration with `--skip-vault` and no seed/role/history flags. Its single outer DO statement keeps the locks, empty-state guard and all five replacements atomic even with an autocommit migration transport; an enclosing transaction remains supported. It replaces five existing functions with unchanged signatures, SECURITY INVOKER/search_path and ACLs. Inspect the actual resulting function definitions and grants, repeat the aggregate/disabled-gate checks, then obtain fresh exact-merged-SHA schema approval. If a transport attempt fails, inspect the actual ledger and definitions before considering a retry; never infer success or reapply a committed migration.
5. Deploy through the repository production guard, keeping finals disabled through old/new application overlap. Verify the deployed SHA and booking samples. Activation of photo-final processing remains a separate operation.

## Rollback

With finals disabled and empty state, the previous application can serve its existing booking flows against this schema; keep all finals flags disabled. A code rollback restores the prior video behavior and vulnerable dependencies, so it is an emergency measure, not a security remediation. Do not reverse the database migration after any revision-2 work exists. Before activation, use a separately reviewed forward change if correction is needed; do not rewrite historical profile rows or immutable object bytes.
