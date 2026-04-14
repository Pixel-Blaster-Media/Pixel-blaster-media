# Pixel Blaster Booking

Booking system + realtor delivery portal for [Pixel Blaster Media](https://www.pixelblastermedia.com).
Lives in this `/booking` subfolder so the main marketing site at the repo
root stays untouched. Deploys independently — recommended at
`book.pixelblastermedia.com`.

> **Status: Phase 2 — public booking form is live.** Realtors can submit
> a request from `/book`; submissions land in `booking_requests` and fire
> confirmation + admin-notification emails via Resend. Auth, admin board,
> and iGuide/Fotello integrations are still to come — see the roadmap.

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
| 2 | Public booking form → Supabase + Resend confirmation emails | ✅ this PR |
| 3 | Admin job board (status pipeline, manual deliverable URL paste) | ⏳ |
| 4 | iGuide API integration (auto-pull tour + floor plan) | ⏳ |
| 5 | Fotello API integration (auto-pull gallery) | ⏳ |
| 6 | Realtor magic-link portal with embedded gallery + tour per property | ⏳ |

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

| Path             | Purpose                                              |
|------------------|------------------------------------------------------|
| `/`              | Booking app landing page                             |
| `/book`          | Public booking form (working — writes to Supabase)   |
| `/book/success`  | Post-submit confirmation                             |
| `/portal`        | Realtor sign-in + property dashboard (Phase 6)       |
| `/admin`         | Admin job board (Phase 3)                            |
| `/api/health`    | Liveness probe — JSON `{ ok: true, ... }`            |

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
│   ├── layout.tsx                # Header / footer shell, Tailwind base
│   ├── page.tsx                  # Booking app landing page
│   ├── globals.css
│   ├── book/
│   │   ├── page.tsx              # Public booking page (server)
│   │   ├── BookingForm.tsx       # Form (client component)
│   │   ├── actions.ts            # Server action: validate + insert + email
│   │   └── success/page.tsx      # Confirmation page
│   ├── portal/page.tsx           # Realtor portal (Phase 6)
│   ├── admin/page.tsx            # Admin (Phase 3)
│   └── api/health/route.ts       # Health check
├── lib/
│   ├── booking/
│   │   ├── services.ts           # Service / add-on catalog (single source)
│   │   └── schema.ts             # Form types + validation
│   ├── email/
│   │   ├── resend.ts             # Resend HTTP wrapper (no-op without key)
│   │   └── templates.ts          # HTML email templates
│   └── supabase/
│       ├── client.ts             # Browser client
│       ├── server.ts             # Server + service-role clients
│       └── database.types.ts     # Regenerate with `npm run db:types`
├── supabase/
│   └── migrations/
│       ├── 0001_init.sql              # Profiles, properties, bookings, deliverables
│       └── 0002_booking_requests.sql  # Public-form submissions
├── .env.example
├── next.config.mjs
├── package.json
├── postcss.config.mjs
├── tailwind.config.ts
└── tsconfig.json
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
