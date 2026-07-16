# Vercel Deployment Policy

Vercel deployments are billable for this project. Minimize them without weakening production verification.

## Booking app (`pixel-blaster-media`)

- Vercel root directory: `booking/`
- Automatic Git deployments: production branch `main` only
- Feature-branch preview deployments: disabled by default
- Affected-project filtering: enabled in Vercel project settings
- Expected deployment count for normal backend/config work: **one production deployment after merge**
- Create a preview manually only when browser QA of unreleased UI is materially useful

Run local tests, TypeScript, lint, and a production build before merging. Batch related changes into one reviewed PR.

## Static website (`pixel-blaster-media-website`)

- Vercel root directory: repository root
- Git integration: disconnected to prevent booking-only commits from rebuilding the website
- Production domains remain attached to the existing Vercel project
- Deploy manually only when root website assets/configuration change (`index.html`, CSS, JavaScript, images, videos, root `vercel.json`, and related static files)

Before a manual website deployment, link an isolated clean working copy to `pixel-blaster-media-website`, deploy production once, and verify both `pixelblastermedia.com` and `www.pixelblastermedia.com` return successfully.

## Exceptions

A manual redeploy is justified for a production-only failure, required environment-variable activation, or stale/corrupt build artifact. Record the reason and verify the exact deployment and production alias afterward.
