# Pixel Blaster Booking

Booking system + realtor delivery portal for [Pixel Blaster Media](https://www.pixelblastermedia.com).
Lives in this `/booking` subfolder so the main marketing site at the repo
root stays untouched. Deploys independently — recommended at
`book.pixelblastermedia.com`.

> **Status: Phase 5 — Fotello auto-sync is live.** All eight roadmap
> phases shipped. Photographer pastes Fotello listing_id + enhance_ids
> into the admin booking page; our backend polls Fotello, and when an
> enhance completes the gallery shows up on the realtor portal as an
> iframe (with a copy-link + open-in-new-tab fallback). Zero storage
> on our side — galleries stay on Fotello via a server proxy that
> refreshes expired signed URLs transparently.

## Stack

- **Next.js 14** (App Router, TypeScript, React 18)
- **Tailwind CSS** for styling, brand-matched to the main site palette
- **Supabase** — Postgres + Auth + Storage. Used via `@supabase/ssr` for
  cookie-based auth across server / client / route handlers.
- **Vercel** for hosting (zero-config, set the project root to `booking/`)
- Phase 4/5 will add server-side wrappers for the **iGuide** and **Fotello** APIs

## Roadmap

| Phase | Scope | State |
|------:|-------|:------|
| 1 | Next.js + Tailwind scaffold, Supabase schema, placeholder routes, deploy-ready | ✅ |
| 2 | Public booking form → Supabase + Resend confirmation emails | ✅ |
| 3 | Magic-link auth + admin inbox / job board / manual deliverable entry | ✅ |
| 4 | iGuide RESO autofill sync + webhook (tour + floor plan) | ✅ |
| 5 | Fotello API integration (auto-pull gallery) | ✅ this PR |
| 6 | Realtor portal: sign in, list of listings, tour + floor plan + gallery per property | ✅ |
| 7 | QuickBooks Online invoicing on delivery | ✅ this PR |
| 8 | Private calendar: realtor self-serve booking + admin settings + agenda view | ✅ |

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
| `/`                     | Booking app landing page                                      |
| `/book`                 | Public booking form (working — writes to Supabase)            |
| `/book/success`         | Post-submit confirmation                                      |
| `/auth/sign-in`         | Magic-link sign-in (admins + realtors share this)             |
| `/auth/check-email`     | "We sent you a link" page                                     |
| `/auth/callback`        | Code → session exchange (set by Supabase magic link)          |
| `/admin`                | Redirects to `/admin/inbox`                                   |
| `/admin/inbox`          | Booking-request inbox with status filters                     |
| `/admin/inbox/[id]`     | Single request detail; accept (creates booking) / decline     |
| `/admin/bookings`       | Job board: confirmed bookings with status filters             |
| `/admin/bookings/[id]`  | Booking detail; status pipeline + manual + iGuide deliverable |
| `/api/integrations/iguide/webhook` | Receives iGuide `ready` events and triggers sync   |
| `/portal`               | Realtor property list (gated on sign-in; admins bounce to /admin) |
| `/portal/[propertyId]`  | Property detail: tour iframe, floor plan PDF, gallery + copy-link |
| `/portal/book`          | Private calendar — realtor self-service booking                   |
| `/admin/calendar`       | 60-day agenda view of bookings + blocks                            |
| `/admin/settings/availability` | Edit weekly hours + add / remove busy blocks                |
| `/admin/settings/pricing`      | Edit per-service + add-on prices                            |
| `/admin/settings/integrations` | Connect / disconnect QuickBooks + pick default service item |
| `/api/integrations/quickbooks/callback` | OAuth callback for QuickBooks consent flow         |
| `/api/fotello/embed/[deliverableId]`   | Auth-gated proxy for Fotello gallery iframe src    |
| `/api/health`           | Liveness probe — JSON `{ ok: true, ... }`                     |

## Provisioning Supabase

1. Create a new project at <https://supabase.com>.
2. From **Project Settings → API**, copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (server only — never expose)
3. Apply the migrations in order. Two options:
   - **Easy:** open Supabase **SQL Editor**, paste each file from
     `supabase/migrations/` (in numeric order) and run them one at a time.
   - **CLI:** install `supabase` CLI, link the project, then
     `supabase db push`.
4. (Optional, recommended) Promote yourself to admin once you've signed up:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

The migrations set up:

- `profiles`, `properties`, `bookings`, `deliverables` tables (0001)
- `booking_requests` table for unauthenticated public submissions (0002)
- A trigger that auto-creates a `profiles` row on every Supabase Auth signup
- An `is_admin()` helper + Row Level Security policies so realtors only ever
  see their own data, while admins see everything

### Becoming the first admin (Phase 3)

Magic-link sign-in is gated to existing accounts only — random visitors
can't spin up empty profiles by submitting the sign-in form. To bootstrap:

1. Open Supabase **Authentication → Users → Add user**, enter your email,
   tick "Auto Confirm User," and create. The DB trigger inserts a matching
   `profiles` row.
2. Promote yourself in SQL:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
3. Visit `/auth/sign-in`, enter the same email, click the magic link,
   land on `/admin/inbox`.

Realtor accounts get auto-provisioned the moment you click **Accept**
on their booking request — no manual steps.

### Realtor onboarding (Phase 6)

Realtor sign-ups are deliberately gated to existing accounts only —
`shouldCreateUser: false` on `signInWithOtp` means random visitors can't
provision empty profiles. The intended flow:

1. Realtor books a shoot via `/book` (public, no account needed).
2. You accept the request from `/admin/inbox/[id]` — this silently
   creates an auth user + profile + property + confirmed booking.
3. Send them the portal URL (`https://book.pixelblastermedia.com/portal`)
   and their email. They request a magic link, click it, and land on
   their listings.
4. Each listing shows status + embedded virtual tour + floor plan +
   any manual/Fotello gallery links, with a "Copy link" button next to
   every URL so they can forward them to buyers.

A future enhancement worth building: auto-email the portal link on the
"accepted" transition so you don't have to do it by hand. The plumbing
(profile email + Resend) is already in place.

### Configuring the calendar (Phase 8)

The migration seeds **Mon–Fri 9–5** as your working hours. Edit them in
`/admin/settings/availability` once you're signed in as admin.

Other knobs:

- **Timezone** is hardcoded to `America/Toronto` in `lib/booking/availability.ts`.
  If you move or travel, change that constant — one spot.
- **Service durations** live in `lib/booking/services.ts` (`durationMinutes`
  on each service / add-on). They bake in your drive + prep time per your
  preference — the calendar does not add a cross-shoot buffer.
- **Auto-confirm** is on for realtor self-bookings. Change this by editing
  the `status: "confirmed"` line in `app/portal/book/actions.ts` if you
  decide you'd rather approve them manually.
- **Block labels are private.** Only admins see the "Vacation — Hawaii"
  text on a block; realtors only see the slot as unavailable.

### Setting up QuickBooks Online (Phase 7 invoicing)

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

### Setting up Fotello (Phase 5 sync)

Fotello hosts your enhanced photos for **one year**. We don't mirror —
we just serve fresh gallery URLs through a server proxy. Much cleaner,
zero storage cost on your side.

**One-time setup:**

1. Email Fotello support (`support@fotello.co`) asking for your API key.
   Gavin on their team handles this — mention you're ready to integrate.
2. When the key arrives in their secure chat, paste it straight into
   Vercel env vars as `FOTELLO_API_KEY`. **Don't put it in email or
   anywhere that syncs in plaintext.**
3. Leave `FOTELLO_API_BASE` blank — the default points at their
   production Firebase Functions endpoint.

**Per-shoot workflow:**

1. You do your normal Fotello UI flow: create a listing, upload photos,
   submit them for enhancement (one batch or multiple, interior +
   exterior, etc.).
2. Copy the **listing id** and each **enhance id** out of Fotello's
   dashboard.
3. In our admin booking detail page, in the Fotello section:
   - Paste the listing id → **Save**.
   - For each enhance: paste the id, pick interior/exterior, click
     **Track**. We poll Fotello. If the enhance is already
     `completed`, the gallery shows up on the realtor portal
     immediately; if it's still `in_progress`, click **Refresh**
     later and it'll flip to ready.
4. Realtor's portal property page renders each ready gallery as an
   iframe embedded in-page. Expired signed URLs are auto-refreshed by
   `/api/fotello/embed/[id]` on every view.

**If Fotello blocks iframing:** the portal also renders a "Copy gallery
link" and "Open ↗" button above each iframe, so realtors always have a
way to get to the gallery even if the iframe renders blank.

**Future polish (not in this phase):**

- Vercel cron that auto-polls in-progress enhances every 5 min so you
  never have to click Refresh manually.
- A "drop raw photos into admin" UI that calls createUpload +
  createEnhance for you, cutting out the step of opening Fotello's UI
  at all. Only worth building if the copy-paste step gets annoying.

### Setting up iGuide (Phase 4 sync + webhook)

The Phase 4 integration only uses iGuide's **public RESO autofill endpoint**
(`https://youriguide.com/{id}/reso/autofill`), which doesn't require an
API key — every published view exposes its data publicly. Your iGuide API
key + OAuth credentials aren't needed for the current flow; we leave the
env vars in place for later phases that may want to list account-owned
views or read drafts.

**To use it:**

1. After publishing a tour in iGuide, copy either the URL
   (`https://youriguide.com/1044_rest_acres_rd_brant_on/`) or the bare
   ID (`1044_rest_acres_rd_brant_on`).
2. Open the matching booking in `/admin/bookings/[id]`, paste it into
   the iGuide field, click **Save**, then **Sync from iGuide**.
3. Two deliverables show up: a `virtual_tour` (with iframe embed snippet)
   and a `floor_plan` (imperial PDF). Re-syncing is idempotent.

**To wire up the webhook (so sync happens automatically on publish):**

1. Generate a long random secret:
   ```bash
   openssl rand -hex 32
   ```
2. Set it as `IGUIDE_WEBHOOK_SECRET` in your env vars (Vercel + `.env.local`).
3. In your iGuide portal, configure a webhook with URL:
   ```
   https://book.pixelblastermedia.com/api/integrations/iguide/webhook?secret=<that-same-secret>
   ```
4. Subscribe to the `ready` event.
5. When you publish a tour that's already tagged on a booking, the
   webhook fires, our handler runs the same sync, and the deliverables
   appear without any clicking.

If iGuide later documents HMAC signature signing on webhooks, swap
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

1. Push this branch to GitHub (already wired to
   `claude/real-estate-booking-site-X3Kyh`).
2. In Vercel, **New Project → import this repo**.
3. Set **Root Directory** to `booking`.
4. Add environment variables from `.env.example` in **Settings → Environment Variables**.
5. Deploy. Once you have the Vercel domain working, point
   `book.pixelblastermedia.com` at it via your DNS provider and add the
   custom domain in Vercel.

The main marketing site (`/index.html`, `/style.css`, etc. at the repo
root) is **not** part of this Vercel project — it continues to deploy
however it does today, untouched.

### Linking from the main site (later)

When Phase 2 ships and the booking flow is live, swap the Acuity URL in
the root `index.html` nav from `https://PixelBlaster.as.me/` to
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
│   │   └── book/                        # Self-serve calendar (Phase 8)
│   │       ├── page.tsx                 # Service + slot picker + confirm
│   │       ├── ServicePicker.tsx · SlotPicker.tsx · BookingConfirmForm.tsx
│   │       ├── slot-types.ts · actions.ts
│   └── api/health/route.ts              # Liveness check
├── lib/
│   ├── auth/
│   │   ├── require-user.ts              # Any signed-in user
│   │   ├── require-admin.ts             # Admins only
│   │   └── sign-out.ts                  # Server action
│   ├── booking/
│   │   ├── services.ts                  # Service / add-on catalog + durations
│   │   ├── schema.ts                    # Form validation
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
├── supabase/migrations/
│   ├── 0001_init.sql
│   ├── 0002_booking_requests.sql
│   ├── 0003_iguide.sql                  # iguide_id on bookings + index
│   ├── 0004_calendar.sql                # business_hours + calendar_blocks
│   ├── 0005_quickbooks.sql              # qb connection + service_prices + invoice cols
│   └── 0006_fotello.sql                 # fotello_listing_id on bookings
├── .env.example · .eslintrc.json · next.config.mjs
├── package.json · postcss.config.mjs · tailwind.config.ts · tsconfig.json
```

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. It must only
  ever be used in server code (`lib/supabase/server.ts → getServiceSupabase`)
  and never imported into a Client Component.
- `iGuide` and `Fotello` API keys live in server-only env vars; Phase 4/5
  will add `app/api/...` route handlers that proxy those calls so the keys
  never reach the browser.
- `metadata.robots` is set to `noindex/nofollow` in `app/layout.tsx` for
  the duration of the scaffold. Flip that off in Phase 2 once the booking
  flow actually works.
