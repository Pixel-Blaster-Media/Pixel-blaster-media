# Production release evidence

The manual `booking/scripts/deploy-production.sh` gate requires more than a clean
checkout. `--check-only` checks **target identity only**, not release readiness.
The only production target is `pixel-blaster-media`
(`prj_QmEJtyuVnVhXILDCJiTPbZr2EdT5`), with Root Directory `booking`.
Never deploy/configure the duplicate project named `booking`.

## Approval procedure

1. Integrate the complete release, regenerate `booking/supabase/setup.sql`, review,
   merge, and wait for the **merged SHA's main push CI**. PR/merge-ref CI is not a
   substitute. The guard reads the latest run of `.github/workflows/ci.yml` via
   authenticated `gh api` and requires successful exact-SHA Application,
   PostgreSQL integration and Marketing proxy jobs from that run attempt.
2. Independently inspect the intended live Supabase project read-only. Review the
   migration ledger **and actual required schema, RPC signatures, grants/policies,
   and compatibility with old and new application versions**. A fresh bootstrap
   pass or filename ledger alone does not prove production compatibility. Preserve
   that read-only evidence in the audit report. If project access fails, stop.
   Divergent production history must be reconciled separately; never use
   `--include-all`, fresh `setup.sql`, or guessed migrations on production.
3. Have the accountable release reviewer create the JSON approval below **outside
   the repository** after compatibility has been verified. The migration manifest
   contains every candidate `booking/supabase/migrations/*.sql`, sorted by filename,
   with SHA-256 of exact file bytes. Do not automatically mark compatibility true
   just because a manifest can be generated. Approval expires after one hour and
   binds to the exact final merged SHA. This is a trusted local operator attestation,
   not a cryptographic signature or an automatic live-database verification.
4. Supply `PRODUCTION_SCHEMA_EVIDENCE=/absolute/path/approval.json` and
   `PRODUCTION_SUPABASE_PROJECT_REF=<independently-verified-project-ref>` when
   invoking `booking/scripts/deploy-production.sh` from the clean repository root.
   The guard fails closed on missing/stale/wrong-target/changed-byte evidence,
   unsuccessful CI, missing jobs, API failure, or candidate/tree changes during
   verification. `gh` must have read access to repository Actions.
5. After an authorized deployment, read back the Ready deployment, exact Git SHA,
   canonical project/root, production aliases and proxy/app relationship. Execute
   approved health/security checks and record rollback evidence. The preflight
   gate does not claim to perform post-deployment verification.

Approval shape (placeholders, **not usable evidence**):

```json
{
  "version": 1,
  "candidateSha": "<40-character final merged Git SHA>",
  "project": "pixel-blaster-media",
  "rootDirectory": "booking",
  "supabaseProjectRef": "<verified 20-letter ref>",
  "approvedBy": "<accountable reviewer>",
  "approvedAt": "<current ISO timestamp after verification>",
  "compatible": true,
  "verification": "<durable read-only schema/ledger/ACL evidence reference and review conclusion>",
  "migrations": [
    {"name": "<first exact filename.sql>", "sha256": "<64-character exact-file digest>"}
  ]
}
```

## CI database boundary

`tests/postgres/clean-bootstrap.test.mjs` starts an isolated PostgreSQL 17 cluster
on a private Unix socket with TCP disabled, creates only a minimal Supabase
platform boundary (Auth users/functions, API roles/default grants, storage buckets),
regenerates and executes the **entire** candidate setup in one transaction, and
checks runtime RPC ACLs, private-note isolation and real Auth-trigger tenant
provisioning/read/write behavior. CI separately regenerates setup and rejects
uncommitted output drift. Existing focused race/rollback suites remain required.
This is Supabase-compatible SQL execution, not a full GoTrue/PostgREST/storage
service stack and not evidence of live production schema state.

## Automatic deployment integration requirement

Disable unguarded Git deployment for **all branches including main** in
`booking/vercel.json` (`git.deploymentEnabled: false`, or an equivalent all-false
branch map). The recovery lane owns that file and its cron changes. Retain both
that disablement and the cron changes when integrating. Do not treat QUALITY-01
as operationally closed until the deployed Vercel configuration/control plane
has been read back and any existing unguarded auto-deploy path disabled through
an independently authorized settings/release operation. Direct CLI access can
bypass repository scripts; restrict deployment authority operationally.
