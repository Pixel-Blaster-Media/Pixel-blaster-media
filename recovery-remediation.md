# Recovery remediation — local implementation, integration gate outstanding

Scope: LIFE-04/05/06 and MEDIA-04 scheduler registration. Base e625365. No external writes, push, deployment, applied production migration, or runtime configuration change.

## Implemented and preserved
- Recovered prior work in place; original SQL, tests, runner, route and scheduler archived at `/Users/PlatoTheBot/.hermes/audits/pixel-booking-2026-09-05/recovery-preserved-original.tar.gz`.
- `20260905100500_booking_effect_generations.sql`: independent effect/schedule versions, immutable historical job keys/payloads, deferred final-aggregate refresh, replacement of never-attempted obsolete confirmation/admin/invoice jobs, manual dead letters for attempted obsolete requests; existing unexpired leases preserved. Calendar still projects current state.
- Refresh now reconstructs current realtor contact fields as well as property, schedule and immutable stored price lines. It does not reprice from today's catalog.
- `20260905100700_booking_reminder_recovery.sql`: service-only schedule-scoped intent, rolling next-24-hour due selection, leases, stable provider identity, bounded backoff/attempt window, rendered-request hash, settlement fencing and schedule-qualified sent stamp. Invoice retains 20260905100600.
- Reminder route uses queue RPCs and actual accepted provider IDs. Quiet notifications remain suppressed, push best effort first-attempt only. Failed/skipped provider sends never stamp sent evidence.
- Outbox drains at most three pages of five identities within one shared deadline. Repository crons: reminders every 10 minutes, outbox every 5 minutes, Autoenhance every 10 minutes offset by 3. This only registers the existing media runner: media lane owns safe reconciliation, no ambiguous mutation retry was added here.
- Repository Vercel Git deployment disabled including main. Quality's real release-evidence fixture and blocked-without-evidence assertion are preserved. Its identical deploy script and verifier are included to exercise these tests in this standalone worktree; parent already carries them at 8c181f3.
- Regenerated setup with repository generator; additive database RPC types and docs updated.

## Real execution
- Recovered PostgreSQL suite passed initially; this is inherited verification, not a claimed new RED cycle.
- Added actual SQL stale-contact regression. Observed RED: `current effect must reconstruct realtor snapshot`; durable log `recovery-contact-red.log` in audit directory.
- After contact reconstruction fix, disposable PostgreSQL 17 behavior/edge/concurrency suite passed repeatedly, including observed PostgreSQL Lock wait fencing concurrent reminder claims.
- Final `npm test` exit 0 (log `recovery-final-tests.log`), `npm run typecheck` exit 0, `npm run lint` exit 0, `git diff --check` exit 0.
- No live provider calls or production-state verification performed by this lane. Parent reports restored production SQL access and Pro plan; actual deployment/runtime flags remain parent verification responsibilities.

## Required integrated gate — NOT yet proven here
1. Run actual lifecycle `save_admin_booking_aggregate` create then edit with recovery migrations present; force deferred constraints and assert current realtor contact, final lines, retained historical pricing and superseded generation. Inject refresh failure and prove booking+lines rollback. The local recovered SQL fixture tests final aggregate replacement but does NOT invoke the concurrently changing admin aggregate RPC. Do not count it as that missing proof.
2. Lifecycle owns `lifecycle_version` and its conservative every-update trigger. This lane does not add or alter it. The old progress note demanding a narrow lifecycle trigger is withdrawn in favor of the current lifecycle contract. Recovery can advance lifecycle_version during deferred effect bookkeeping; the returned aggregate version may therefore be stale after commit. Parent/lifecycle must either explicitly refresh effects before reading the return version (migration-safe hook) or otherwise verify callers reload persisted version. Do not represent this integration boundary as closed.
3. Merge additive types/package changes and regenerate setup after ALL lane migrations; preserve quality regression changes and manual release guard. Complete full integrated bootstrap and application gates.
4. Update root deployment policy's stale automatic-main wording when integrating quality/recovery docs. Read back actual Vercel configuration after an authorized release; repository Git flags do not retroactively change the already deployed control plane.
5. Validate real enabled flag/watermark and deployed cadence; do not use `--include-all`. Media lane must finish ambiguity-safe handoff recovery before scheduled promotion.

This is a committed local recovery implementation with explicit integration blockers, not a claim that every finding is closed or shipped.
