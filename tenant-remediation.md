# Tenant remediation — bounded preflight correction

Scope: TENANT-PREFLIGHT-01 and TENANT-PREFLIGHT-02 from the BLOCK review of `df11a897d86f6bcf0dc0cd1c1f548017cc993f5e`, within existing SEC-02 / QUALITY-03. No expansion of the original 19-finding audit. Parent owns exact-candidate release review.

## Correction

- Move active unscheduled-request priority and original schedule/creation ordering into SQL before LIMIT; UUID breaks exact ties only. Realtor order remains full_name ASC NULLS LAST, email ASC, UUID.
- Use matching JSONB composite keysets, return exact `_cursor` keys, validate route inputs and preserve timestamp microseconds. Pages no longer re-sort a UUID-selected sample. Invalid legacy links reset to first page.
- Cover every existing labelForService mapping in SQL, retaining raw-slug fallback and existing legacy add-on matching. Executed Node parity checks and PostgreSQL label threshold checks prevent a partial duplicate map.
- No listing integrity, tenant predicate, full-history aggregate or execution-role relaxation. Regenerated setup.sql via its generator.

## Actual TDD evidence

1. New PostgreSQL order fixture on the original search SQL failed: `jobs operational ordering displaced at position 1`. After composite SQL correction, 160-job and 160-realtor ordered traversals passed, as did existing 1,200-booking / 352-realtor traversal and tenant/integrity checks.
2. New Node display-label parity test failed for `blue_print`: undefined versus `The Blue Print`. Real PostgreSQL then failed `display-label threshold failed: The Blue Print`. An initial test extraction accidentally included preferred-time labels; that fixture error was corrected before accepting the genuine service-label RED. Complete catalog mapping made both tests GREEN; all legacy/catalog labels and raw slugs were exercised with 51 rows each.
3. New route cursor test failed `composite cursor parser required`. Complete parser and route integration made it GREEN, including missing fields, malformed/legacy UUIDs, invalid priority/date and exact microsecond preservation.

## Verified local gates

- `npm run test:postgres:tenant-search`: PASS on disposable PostgreSQL 17; structural policies, rollback, ownership, full-history thresholds, labels and ordered traversal. Runner tears down in finally. Bootstrap emits expected missing-object NOTICE messages.
- `npm test`: 479 passed, 0 failed, 0 skipped.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS, no warnings.
- `npm run db:setup`: regenerated exact migration aggregate.

## Release constraints

This is an unshipped candidate correction, not a production migration or deployment. JSONB signatures replace the candidate UUID signatures; if any earlier candidate exists in another database, reconcile its ledger and obsolete overloads before application rollout. Non-snapshot pagination still requires first-page refresh after changes ahead of a cursor. No production access, push, deployment, configuration change, PostgREST HTTP proof or full-platform-bootstrap attestation occurred. Parent must review the new exact commit and retain live migration/integrity gates.
