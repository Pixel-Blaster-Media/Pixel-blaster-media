# Legacy media correction verification

Scope: MEDIA-02/04/05 follow-up to `0a62e8bddec4a7c5d0daa145fc7e19b5eac00334`. No migrations, provider configuration, external requests, uploads, pushes, or deployments.

## Corrections

- Replace the first-100 prefix with receipt-aware eligible ordering: unclaimed images, affirmative safe retries, then oldest reconciliation work. Retain one new upload per invocation and the enclosing network deadline. Accepted polls rotate their existing receipt timestamp before transport so a timed-out oldest poll does not monopolize later invocations. Rotation retains the same claim and accepted identity; it never authorizes re-upload.
- Fence refresh summary writes with the loaded batch `updated_at`, using the existing legacy trigger. A stale refresh returns a save conflict rather than overwriting a newer aggregate/status/portal. A subsequent scheduler/admin refresh rebuilds from durable receipts; there is no automatic provider replay on conflict.
- Validate raster dimensions (positive, at most 16,384 per axis), 40-million-pixel budget, and single-page shape with the installed Next-compatible `sharp`. Force full decode with strict warning rejection and a 10-second processing timeout, retaining the original bytes and MIME. PDF/ZIP behavior is unchanged.

## Executed evidence

- Reproduced RED: all three 160-image progress cases (100 uploaded/pending/historical-failed receipts) sent zero images; safe retry behind accepted polls waited behind 159 polls; dimension and corrupt-image cases were accepted; stale PostgreSQL summary erased a concurrent winner; nonterminal polling did not advance its timestamp.
- GREEN: `npm test`: 503 passed, zero failed/skipped. `npm run typecheck`, `npm run lint`, and `git diff --check`: exit 0. Existing typeless-package warnings remain.
- `node scripts/verify-legacy-media-cas.mjs`: exit 0. Creates and destroys a local PostgreSQL cluster inside this workspace, applies the actual legacy media migration with minimal parent fixtures, and runs the real workflow and Supabase query builder through a small SQL transport. Independent PostgreSQL sessions prove one concurrent claim winner, one safe-retry winner, one terminal receipt winner, tenant/batch/portal/image/token/status fencing, pending-poll rotation, same-invocation receipt aggregation, and stale-summary rejection.
- Valid JPEG, PNG, WebP, and AVIF preserve bytes. A PNG with readable dimensions but truncated compressed pixels fails full decoding.

## Finite integration/release gates

1. Parent exact-candidate review and production build, including native `sharp` packaging on the deployment target (currently supplied by the installed Next dependency; no dependency/config changes here).
2. Actual deployed Supabase/PostgREST, roles/RLS, and production-schema verification. The SQL transport proves real PostgreSQL CAS semantics with actual application predicates, not a live PostgREST deployment or authorization policy.
3. Parent-owned scheduler registration/cadence and authorized provider upload/process/readiness verification. No provider behavior is claimed from fixtures.
4. Accepted permit without a durable job, and historical ambiguous receipts, remain deliberate operator reconciliation—not re-upload candidates. No quarantine/checksum/general upload foundation is claimed. Network deadlines and bounded decoding are not a hard wall-clock guarantee for uncooperative DB/credential adapters.

## Reusable local CAS proof procedure

Keep the actual query builder and application functions. Substitute only transport, translating every equality predicate into one atomic SQL statement against the migration under test. Run competing calls on independent sessions, assert both winner cardinality and final persisted rows, and pause a refresh after its read while another writer advances the row version. Always verify zero-row CAS rejection, not merely query shape. Use a disposable loopback-only cluster and remove it in `finally`; do not repurpose production credentials or schemas.
