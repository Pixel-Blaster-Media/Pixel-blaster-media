# Photo-finals ingest P2 closure (local only)

Starting candidate: `1db6b908fba152e97f2e564390bf8e6e7c4b2215`.

## Reproduced RED

Executed the existing independent review repro at
`/Users/PlatoTheBot/.hermes/cache/photo-finals-review-57a25f3-repro.py`,
substituting only its ROOT with this worktree. Actual local PG and worker output:

- Wrong-scope job mutated to `{"state":"retryable","attempts":1}`.
- Valid JPEG plus one failed scanning checkpoint became
  `{"state":"rejected","completed":true}`; replacement intent failed.
- Added durable integration assertions before implementation; the local ingest
  suite failed at the wrong-scope worker call (`finals_envelope_scope_mismatch`).

## Changes

- Claim now requires organization, booking, property, job and worker arguments.
  Its initial locked selection checks the complete batch/job scope before any
  attempt insertion, expiry settlement, lease or version mutation. No legacy
  unscoped overload is installed. Types, callers and grants match.
- JPEG decoding has no database callback. Only decoder/content validation is
  inside the invalid-content catch; the scanning checkpoint is outside it.
- Retry settlement retains quarantined/validating phases when their canonical
  transition graph has no retryable edge. It records a retryable attempt, clears
  the fenced lease and sets the next due time. Existing claim/stage replay then
  resumes the same intent/version. Exhaustion still dead-letters. Neither the
  canonical transition graph nor the package migration's shared trigger changed.
- The ingest runner now applies the package migration too. Setup SQL was rebuilt
  with `npm run db:setup`; the original migrations have not been deployed.

## Executable GREEN evidence

`npm run test:postgres:finals-ingest` verifies:

- Full job/version/attempt snapshots unchanged for wrong booking, property and
  organization. The booking case uses a real second same-tenant booking.
- Expired, exhausted, wrong-scope claims also leave those snapshots unchanged.
- One failed checkpoint at each of quarantined, validating and scanning remains
  nonterminal with a retryable attempt; replay accepts the same intent/version.
- Invalid JPEG and PNG still reject, real JPEG decode works, ambiguous immutable
  PUT recovers, stale leases remain fenced, and the three existing observed-lock
  races pass.

`npm run test:postgres:finals-packages` additionally probes analogous package
scope denial with full row snapshots and injects a heartbeat transport failure.
The same package job remains retryable and ultimately ready; neither blocker
reproduced there, so package implementation and migration are untouched.
Existing ZIP order/content/CRC, 48 evidence-rollback probes and four observed-lock
races remain green.

Other passing gates: 608 application tests; typecheck; lint; production build;
`test:postgres:photo-finals` (both observed-lock orderings);
`LC_ALL=C TMPDIR=/tmp npm run test:postgres:media`; `git diff --check`.
The canonical runner initially could not start PostgreSQL; a disposable startup
probe reported `postmaster became multithreaded during startup` and requested a
valid LC_ALL. The explicit local C locale resolved it without repository changes.

Storage evidence uses real R2Storage with test-only in-memory S3 commands, not
live R2. PG uses disposable local clusters, not PostgREST transport. No push,
deployment, production migration, bucket write, credential or configuration
change. Production execution remains disabled. Routing/UI and release gates
remain separate work; iGUIDE, billing and video behavior are untouched.
