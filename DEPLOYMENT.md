# Vercel Deployment Policy

Vercel deployments are billable for this project. Minimize them without weakening production verification.

## Booking app (`pixel-blaster-media`)

- **Canonical Realtor-facing Vercel project:** `pixel-blaster-media` (`prj_QmEJtyuVnVhXILDCJiTPbZr2EdT5`).
- Vercel root directory: `booking/`.
- `pixelblastermedia.com` and `www.pixelblastermedia.com` proxy `/book`, `/portal`, `/auth`, `/admin`, and `/api` to this project through the static website's `vercel.json`.
- The newer Vercel project named `booking` is noncanonical and must never be used for production releases or environment configuration.
- Automatic Git deployments: disabled for every branch, including `main`. Production is promoted manually only after successful exact-SHA CI and reviewed live-schema compatibility; verify the Vercel control-plane setting before merging.
- Feature-branch preview deployments: disabled by default.
- Affected-project filtering: enabled in Vercel project settings.
- Expected deployment count for normal backend/config work: **one production deployment after merge**.
- Create a preview manually only when browser QA of unreleased UI is materially useful.

Run local tests, TypeScript, lint, and a production build before merging. Batch related changes into one reviewed PR.

For a manual production deployment, link the **repository root** to the canonical project and use the fail-closed release command:

```bash
cd /path/to/pixel-booking-canonical
vercel link --yes --project pixel-blaster-media
booking/scripts/deploy-production.sh --check-only
booking/scripts/deploy-production.sh
```

The script refuses to deploy unless the root link has the canonical project ID, Vercel reports Root Directory `booking`, the tree is clean, and `HEAD` exactly matches `origin/main`. Do not run `vercel --prod` directly from `booking/`.

It additionally requires successful exact-SHA main-push CI (Application, PostgreSQL integration, Marketing proxy) and fresh, reviewer-approved schema compatibility evidence. Set `PRODUCTION_SCHEMA_EVIDENCE` and `PRODUCTION_SUPABASE_PROJECT_REF` as described in [Production release evidence](booking/docs/PRODUCTION_RELEASE_EVIDENCE.md). `--check-only` verifies the target only; it does not authorize a release.

## Static website (`pixel-blaster-media-website`)

- Vercel root directory: repository root
- Git integration: disconnected to prevent booking-only commits from rebuilding the website
- Production domains remain attached to the existing Vercel project
- Deploy manually only when root website assets/configuration change (`index.html`, CSS, JavaScript, images, videos, root `vercel.json`, and related static files)

Before a manual website deployment, link an isolated clean working copy to `pixel-blaster-media-website`, deploy production once, and verify both `pixelblastermedia.com` and `www.pixelblastermedia.com` return successfully.

## Exceptions

A manual redeploy is justified for a production-only failure, required environment-variable activation, or stale/corrupt build artifact. Record the reason and verify the exact deployment and production alias afterward.
