# Recovery age snapshot

Read-only `GET /api/cron/recovery-status?organizationId=<tenant UUID>` requires
the existing `Authorization: Bearer <CRON_SECRET>` operator/cron credential.
It is not an end-user endpoint. The credential is globally privileged; the
explicit tenant is mandatory and filters every query. Never expose that secret
in browser code or URLs. No additional schedule or enablement is configured.

The no-store response contains only counts and oldest ages (seconds):

- `outboxUnresolved`: pending, retryable, processing integration jobs.
- `outboxManual`: dead-letter jobs, separately visible without replaying them.
- `mediaUnresolved`: processing, waiting_for_iguide, attention batches, including
  unresolved failed handoffs retained in attention.

Age is time since `created_at` of the oldest unresolved row, not time since
last progress, due time, or eligibility under a dispatch watermark. Poll rotation
updates media `updated_at` even without progress; using it would hide stalls.
These metrics expose old unresolved batches for operator investigation, not an
automatic claim that a particular batch has stalled. Completed/skipped work and
completed media batches are excluded. Historical/disabled work remains visible.

An empty queue has count 0 and null age. Database errors, transport timeouts,
missing counts, inconsistent rows, or invalid/future timestamps yield `unknown`
with null count/age and HTTP 503, never healthy zero. Other successful metrics
remain available. Missing credential configuration also returns 503; wrong
credentials return 401; absent/malformed tenant UUID returns 400 before DB access.
No database errors, row identifiers, payloads, or provider data are returned.

The snapshot uses three parallel queries with a shared three-second abort signal,
one returned timestamp per query, and exact counts. Database count work still
scales with matching rows; the timeout bounds client waiting, not database CPU.
No migration, mutation, provider call, alert product, or scheduling change.