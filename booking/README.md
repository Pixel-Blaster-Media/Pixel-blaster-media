# Pixel Booking

SaaS booking system + realtor delivery portal for real estate media companies.
Pixel Blaster Media is the first/default company, but the app now supports
company workspaces with their own branding, catalog, calendar, integrations,
realtors, and delivery settings.

> **👉 First-time deploy? Use [DEPLOY.md](./DEPLOY.md) instead of this
> file.** It's a step-by-step non-coder walkthrough. This README is for
> the ongoing developer-level reference.

> **Status: SaaS beta.** Public company signup, branded booking pages,
> calendar sync, admin/realtor portals, iGUIDE delivery, listing pages,
> profile memory, and the AI assistant are in active beta. Fotello is
> intentionally hidden from the main workflow until its delivery API shape
> is finalized.

## Stack

- **Next.js 15** (App Router, TypeScript, React 18)
- **Tailwind CSS** for styling, brand-matched to the main site palette
- **Supabase** — Postgres + Auth + Storage. Used via `@supabase/ssr` for
  cookie-based auth across server / client / route handlers.
- **Vercel** for hosting (zero-config, set the project root to `booking/`)
- Server-side wrappers for **iGUIDE**, **Fotello**, **QuickBooks**, **Google Calendar**, **Resend**, and **OpenAI**

## Product Areas

| Area | State |
|------|:------|
| Public company signup + branded booking pages | ✅ beta |
| Admin dashboard, Today command center, calendar, and bookings | ✅ beta |
| Realtor portal, media delivery, custom listing pages | ✅ beta |
| iGUIDE delivery sync and download links | ✅ beta |
| Autoenhance booking upload and iGUIDE gallery handoff | ✅ beta |
| Google Calendar, Resend, QuickBooks integrations | ✅ beta |
| OpenAI-powered assistant and booking recommendations | ✅ beta |
| Fotello API delivery | ⏸ hidden while API details are confirmed |

## Local development

```bash
cd booking
cp .env.example .env.local
# fill in your Supabase URL + keys (see "Provisioning Supabase" below)
npm install
npm run dev
```

App runs at <http://localhost:3000>. Health check: <http://localhost:3000/api/health>.

### Routes

| Path                    | Purpose                                                       |
|-------------------------|---------------------------------------------------------------|
| `/`                     | Platform landing page for company signup / sign-in            |
| `/start`                | Public beta company signup                                    |
| `/book`                 | Default Pixel Blaster public booking form                     |
| `/book?org=company-slug`| Company-scoped public booking form                            |
| `/book/success`         | Post-submit confirmation                                      |
| `/auth/sign-in`         | Password / magic-link sign-in                                 |
| `/auth/check-email`     | "We sent you a link" page                                     |
| `/auth/callback`        | Code → session exchange (set by Supabase magic link)          |
| `/admin`                | Redirects to `/admin/today`                                   |
| `/admin/today`          | Daily command center                                          |
| `/admin/inbox`          | Booking-request inbox with status filters                     |
| `/admin/inbox/[id]`     | Single request detail; accept (creates booking) / decline     |
| `/admin/bookings`       | Job board: confirmed bookings with status filters             |
| `/admin/bookings/[id]`  | Booking detail; status pipeline + manual + iGuide deliverable |
| `/api/integrations/iguide/webhook` | Receives iGuide `ready` events and triggers sync   |
| `/api/integrations/autoenhance/webhook` | Receives completed-photo events and resumes iGUIDE delivery |
| `/portal`               | Realtor property list (gated on sign-in; admins bounce to /admin) |
| `/portal/[propertyId]`  | Property detail: tour iframe, floor plan PDF, gallery + copy-link |
| `/portal/book`          | Sends signed-in realtors into their company-scoped booking wizard |
| `/admin/calendar`       | 60-day agenda view of bookings + blocks                            |
| `/admin/settings/availability` | Edit weekly hours + add / remove busy blocks                |
| `/admin/settings/pricing`      | Edit per-service + add-on prices                            |
| `/admin/realtors`       | Realtor profile details, headshots, delivery CCs, agent memory |
| `/admin/settings/integrations` | Connect Google Calendar, Resend, iGUIDE, OpenAI, etc. |
| `/api/integrations/quickbooks/callback` | OAuth callback for QuickBooks consent flow         |
| `/api/fotello/embed/[deliverableId]`   | Auth-gated proxy for Fotello gallery iframe src    |
| `/api/health`           | Liveness probe — JSON `{ ok: true, ... }`                     |

### Mobile app and notifications

Admins can install the site from **Settings → Mobile app**. The installed app
opens on the calendar, uses a five-item mobile navigation bar, and keeps a
minimal read-only copy of Today available if the phone briefly loses service.
Booking changes remain disabled while offline.

To enable device notifications, apply the `push_notifications` migration and
configure `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
`VAPID_SUBJECT`. Generate one VAPID key pair with
`npx web-push generate-vapid-keys`; do not regenerate it after users subscribe
or their existing device subscriptions will stop working.

## Provisioning Supabase

1. Create a new project at <https://supabase.com>.
2. From **Project Settings → API**, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (server only — never expose)
3. Apply the database schema. Three options (in order of ease):
   - **Easiest for a fresh project:** paste `supabase/setup.sql` into the SQL
     Editor once and click Run. The generated file combines the pre-ledger
     bootstrap history with canonical migrations from the reconciliation
     cutover onward. Use it only on a fresh/empty Supabase project.
   - **Manual fresh-project debugging:** apply the files from
     `supabase/bootstrap-migrations/` in order, followed by canonical files in
     `supabase/migrations/` from version `20260716141227` onward.
   - **Existing linked production:** use `supabase migration list --linked`
     and `supabase db push --linked --dry-run` before applying a new canonical
     migration. `supabase/migrations/` mirrors the production ledger, and
     `supabase/production-migration-ledger.json` preserves the reconciled
     version/name/statement-count/body-hash baseline. Never use `--include-all`
     and never run bootstrap files against production.
4. Deploy the app and visit `/start` to create the first company account.
   That flow creates the company, owner profile, starter catalog, working
   hours, and default settings.

When migrations change, regenerate the one-paste setup file. The generator reads
all pre-ledger bootstrap files, skips their recovered remote aliases, and then
includes canonical migrations from the reconciliation cutover onward:

```bash
npm run db:setup
```

Do not run `supabase/setup.sql` or anything in
`supabase/bootstrap-migrations/` against a live database with customer data.
For live databases, create and apply only a new timestamped file in
`supabase/migrations/` after the linked dry-run names exactly that file.

The schema sets up:

- `profiles`, `properties`, `bookings`, `deliverables` tables (0001)
- `booking_requests` table for unauthenticated public submissions (0002)
- `organizations` and organization-scoped data for SaaS tenant isolation
- A trigger that auto-creates a `profiles` row on Supabase Auth signup
- Organization-aware RLS policies so company admins and realtors stay scoped
  to their own business data

Realtor accounts get auto-provisioned the moment you click **Accept**
on their booking request — no manual steps.

### Realtor onboarding

Realtor accounts are created through a booking/admin workflow so each
realtor belongs to the right company workspace. The intended flow:

1. Realtor books a shoot via the company booking link (for Pixel Blaster,
   `/book`; for another company, `/book?org=company-slug`).
2. You accept the request from `/admin/inbox/[id]` — this silently
   creates an auth user + profile + property + confirmed booking.
3. Delivery emails and portal links bring them back to `/portal`.
4. Each listing shows status, media downloads, iGUIDE links, video links,
   invoices, and custom listing page tools.

Admins can also edit realtor profiles, headshots/logos, delivery CC emails,
and private agent memory from `/admin/realtors`.

### Configuring the calendar

The migration seeds **Mon–Fri 9–5** as your working hours. Edit them in
`/admin/settings/availability` once you're signed in as admin.

Other knobs:

- **Timezone** is hardcoded to `America/Toronto` in `lib/booking/availability.ts`.
  If you move or travel, change that constant — one spot.
- **Service durations** live in `lib/booking/services.ts` (`durationMinutes`
  on each service / add-on). They bake in your drive + prep time per your
  preference — the calendar does not add a cross-shoot buffer.
- **Auto-confirm** is on for public and signed-in realtor bookings. Change the
  `status: "confirmed"` line in `app/book/actions.ts` if you decide you would
  rather approve them manually.
- **Block labels are private.** Only admins see the "Vacation — Hawaii"
  text on a block; realtors only see the slot as unavailable.

### Setting up QuickBooks Online

One-time setup (takes ~5 min):

1. Sign into <https://developer.intuit.com> with the same Intuit account
   that owns your QBO company data.
2. **Dashboard → Create an app → Scorekeeper / Platform app**, pick
   **com.intuit.quickbooks.accounting** as the scope.
3. In the app's **Keys & OAuth** tab:
   - Copy the **Client ID** → env var `QUICKBOOKS_CLIENT_ID`.
   - Copy the **Client Secret** → env var `QUICKBOOKS_CLIENT_SECRET`.
   - Add a **Redirect URI** of exactly:
     ```
     ${NEXT_PUBLIC_APP_URL}/api/integrations/quickbooks/callback
     ```
     Whitespace and trailing slash matter — Intuit matches verbatim.
4. Set `QUICKBOOKS_ENVIRONMENT` to `sandbox` (recommended for testing)
   or `production` when you're ready to create real invoices.
5. Redeploy so the new env vars take effect.
6. Sign in to the admin site, open `/admin/settings/integrations`, click
   **Connect QuickBooks**, grant consent. You're done.
7. Pick a **default service item** (e.g. your existing "Services" item
   in QB). All invoice lines reference this item — a QBO quirk; the
   line descriptions carry the actual service name.
8. Head to `/admin/settings/pricing` and set a real price for every
   service + add-on. Any row still at $0 will block invoice creation.

Per-booking flow once set up:

- Open a booking → the **Invoice** section at the bottom has a
  **Create invoice** button once the booking has a realtor + property.
- Click it → we upsert the realtor as a QB Customer (matched by email),
  build an invoice with one line per selected service + add-on, and POST
  it to QuickBooks.
- The invoice appears in QB exactly like a manually-created one; click
  **Open in QuickBooks ↗** on the booking to jump there.
- Mark it **paid** inside QB as usual. Back on the booking, click
  **Refresh status** to pull the current balance / status.

Failure modes that are handled gracefully:

- Expired access tokens → auto-refreshed via the refresh token.
- Expired refresh token (~100 days idle) → surface "reconnect" prompt.
- Missing price → invoice creation is blocked with a useful error.
- Duplicate create on the same booking → no-op, returns the existing
  invoice id.

### Setting up Fotello

Fotello work is currently hidden from the main admin workflow while the API
delivery shape is confirmed. The app still has a sandbox and server-side
client code, but iGUIDE/manual delivery is the production path for now.

### Setting up Autoenhance

1. Open **Admin -> Settings -> Integrations -> Autoenhance.ai**.
2. Save the company's Autoenhance API key.
3. Copy the webhook URL shown in that section into Autoenhance's API settings.
4. Create a long random webhook secret and save the exact same value in
   Autoenhance's authentication field and the booking app's Webhook secret field.

The booking page uploads camera files directly to Autoenhance&apos;s short-lived
presigned URLs. The API key and webhook secret remain server-side. HDR grouping
defaults to Autoenhance's automatic detection; when the whole order is finished,
only full-resolution production JPEGs are sent to the booking&apos;s linked iGUIDE.

**One-time setup:**

1. Email Fotello support (`support@fotello.co`) asking for your API key.
   Gavin on their team handles this — mention you're ready to integrate.
2. When the key arrives in their secure chat, store it in Settings →
   Integrations for the right company, or in Vercel as `FOTELLO_API_KEY`
   for a single-company fallback. **Don't put it in email or anywhere
   that syncs in plaintext.**
3. Leave `FOTELLO_API_BASE` blank — the default points at their
   production Firebase Functions endpoint.

**Per-shoot workflow:**

Keep the sandbox route admin-only and avoid exposing Fotello API keys or
temporary signed URLs to the browser longer than needed.

### Setting up iGuide (Phase 4 sync + webhook)

The production integration uses iGUIDE's Portal API plus the `ready` webhook.
Create an API Token under **Settings → API Management → API Tokens** with:

- `iguide.read` — refresh tour, floor-plan, and gallery download URLs
- `iguide.write` — create an iGUIDE from a booking
- `iguide.process` — process supplementary photos uploaded to its gallery
- `iguide.events` — re-fetch ready events when needed
- `iguide.list` — search the organization's existing portal tours

Save the token's Client ID and Token in **Admin → Settings → Integrations**.
The public RESO autofill endpoint remains a limited fallback when an admin only
has an old public tour URL. The portal-list endpoint entered iGUIDE's public
documentation in July 2026; the integration test reports whether the saved token
has that optional search permission. Existing tours can always be linked manually.

**To use it:**

1. After publishing a tour in iGUIDE, copy either the URL
   (`https://youriguide.com/1044_rest_acres_rd_brant_on/`) or the bare
   alias (`1044_rest_acres_rd_brant_on`). A Portal ID or manage URL also works.
2. Open the matching booking in `/admin/bookings/[id]`, paste it into
   the iGUIDE field, click **Save**, then **Sync from iGUIDE**.
3. The sync creates or refreshes the tour, floor plans, previews, and any
   available MLS/high-resolution photo ZIPs. Re-syncing replaces stale links
   instead of creating duplicates.

**To wire up the webhook (so sync happens automatically on publish):**

1. Generate a long random secret:
   ```bash
   openssl rand -hex 32
   ```
2. Save it as the iGUIDE Webhook secret in **Admin → Settings → Integrations**
   (or use `IGUIDE_WEBHOOK_SECRET` as the platform fallback).
3. Copy the webhook URL shown on that page into iGUIDE and subscribe to the
   `ready` event. It has this shape:
   ```
   https://<NEXT_PUBLIC_APP_URL>/api/integrations/iguide/webhook?secret=<that-same-secret>
   ```
4. When a tour publishes, the immutable Portal ID, alias, and deliverables are
   matched to a pre-created job, a saved booking link, or one exact property
   address. Unrelated global webhook traffic is acknowledged but not retained.

If iGUIDE later documents HMAC signature signing on webhooks, swap
`?secret=` for proper signature verification (the handler is small —
about 100 lines).

### Setting up Resend (Phase 2 emails)

Booking submissions trigger two emails — one to the realtor (confirmation) and
one to you (heads-up). Both are sent via [Resend](https://resend.com).

1. Create a Resend account, verify your sending domain (`pixelblastermedia.com`).
2. Generate an API key, paste it into `RESEND_API_KEY` in `.env.local`.
3. Set `EMAIL_FROM` to a verified address on that domain.
4. Set `ADMIN_NOTIFICATION_EMAIL` to where you want booking heads-up emails.

If you skip this, the form still works — sends are no-ops and you'll see
warnings in the server logs. The submission still lands in `booking_requests`
either way.

## Deploying to Vercel

1. Push `main` to GitHub.
2. In Vercel, **New Project → import this repo**.
3. Set **Root Directory** to `booking`.
4. Add environment variables from `.env.example` in **Settings → Environment Variables**.
5. Deploy. Once you have the Vercel domain working, point
   `book.pixelblastermedia.com` at it via your DNS provider and add the
   custom domain in Vercel.

The integration outbox recovery route is intentionally fail-closed. Apply and verify migration `20260719124500` before you deploy the compatible application, configure a reviewed canonical UTC `INTEGRATION_OUTBOX_DISPATCH_NOT_BEFORE` cutoff, and keep `INTEGRATION_OUTBOX_DISPATCH_ENABLED=false` through deployment verification. Enable it only for a supervised bounded run; see [`docs/INTEGRATION_OUTBOX.md`](docs/INTEGRATION_OUTBOX.md) for the exact migration-first rollout, scheduler limits, and reconciliation rules.

The main marketing site (`/index.html`, `/style.css`, etc. at the repo
root) is **not** part of this Vercel project — it continues to deploy
however it does today, untouched.

### Linking from the main site

Point any "Book now" button at the company's booking URL, for example
`https://book.pixelblastermedia.com/book`. That's the only change to the
main site that this whole project needs.

## Project layout

```
booking/
├── app/
│   ├── layout.tsx                       # Public site shell
│   ├── page.tsx                         # Landing
│   ├── globals.css
│   ├── book/                            # Public booking flow (Phase 2)
│   │   ├── page.tsx · BookingForm.tsx · actions.ts · success/page.tsx
│   ├── auth/                            # Magic-link auth (Phase 3)
│   │   ├── sign-in/{page,SignInForm}.tsx · sign-in/actions.ts
│   │   ├── check-email/page.tsx
│   │   └── callback/route.ts
│   ├── admin/                           # Admin job board (Phase 3+8)
│   │   ├── layout.tsx                   # Role gate + sidebar + sign-out
│   │   ├── page.tsx                     # Redirects to /admin/inbox
│   │   ├── inbox/
│   │   │   ├── page.tsx                 # Request list
│   │   │   └── [id]/{page,RequestActions}.tsx + actions.ts
│   │   ├── bookings/
│   │   │   ├── page.tsx                 # Job board
│   │   │   └── [id]/{page,BookingActions}.tsx + actions.ts
│   │   ├── calendar/page.tsx            # 60-day agenda (Phase 8)
│   │   └── settings/
│   │       ├── availability/            # Hours + blocks (Phase 8)
│   │       │   ├── page.tsx · HoursEditor.tsx · BlocksManager.tsx · actions.ts
│   │       ├── pricing/                 # Per-service prices (Phase 7)
│   │       │   ├── page.tsx · PriceRow.tsx · actions.ts
│   │       └── integrations/            # QuickBooks connect + item picker (Phase 7)
│   │           ├── page.tsx · ConnectButton.tsx · DisconnectButton.tsx
│   │           ├── ItemPicker.tsx · actions.ts
│   ├── portal/                          # Realtor-facing portal (Phase 6+8)
│   │   ├── layout.tsx                   # Header + sign-out, bounces admins
│   │   ├── page.tsx                     # Property card grid
│   │   ├── [propertyId]/
│   │   │   ├── page.tsx                 # Tour + floor plan + gallery
│   │   │   └── CopyLinkButton.tsx
│   │   └── book/page.tsx                # Redirect into company booking wizard
│   └── api/health/route.ts              # Liveness check
├── lib/
│   ├── auth/
│   │   ├── require-user.ts              # Any signed-in user
│   │   ├── require-admin.ts             # Admins only
│   │   └── sign-out.ts                  # Server action
│   ├── booking/
│   │   ├── services.ts                  # Service / add-on catalog + durations
│   │   ├── booking-status.ts            # Status pipeline + visual meta
│   │   └── availability.ts              # Slot computation (Phase 8)
│   ├── email/
│   │   ├── resend.ts · templates.ts     # Transactional email
│   ├── integrations/
│   │   ├── iguide/
│   │   │   ├── client.ts                # RESO autofill fetch
│   │   │   ├── parse-id.ts              # URL ↔ ID + viewer / embed URLs
│   │   │   └── sync.ts                  # Upsert deliverables from RESO
│   │   ├── quickbooks/                  # QuickBooks Online (Phase 7)
│   │   │   ├── oauth.ts                 # Authorize URL + token exchange + refresh
│   │   │   ├── client.ts                # API client with auto-refresh
│   │   │   └── invoice.ts               # Upsert customer + build + submit invoice
│   │   └── fotello/                     # Fotello photo gallery sync (Phase 5)
│   │       ├── client.ts                # Typed API wrapper (Bearer auth)
│   │       └── sync.ts                  # syncEnhance + getFreshGalleryUrl
│   └── supabase/
│       ├── client.ts · server.ts        # Browser + server + service clients
│       └── database.types.ts            # Regenerate with `npm run db:types`
├── middleware.ts                        # Session refresh + /admin gate
├── supabase/
│   ├── bootstrap-migrations/             # Fresh-project pre-ledger history only
│   │   ├── 0001_init.sql
│   │   └── …
│   ├── migrations/                       # Canonical linked-production ledger
│   │   ├── 20260505212726_iguide_jobs_and_webhook_events.sql
│   │   └── …
│   └── setup.sql                         # Generated fresh-project aggregate
├── .env.example · .eslintrc.json · next.config.mjs
├── package.json · postcss.config.mjs · tailwind.config.ts · tsconfig.json
```

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. It must only
  ever be used in server code (`lib/supabase/server.ts → getServiceSupabase`)
  and never imported into a Client Component.
- iGUIDE, Fotello, Resend, QuickBooks, Google Calendar, and OpenAI secrets
  must stay server-side. Use Settings → Integrations or server-only Vercel
  env vars, never `NEXT_PUBLIC_*`.
- Public listing pages are intended to be shareable; admin, portal, and
  booking-management routes remain auth-gated.
