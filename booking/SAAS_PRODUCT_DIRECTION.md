# SaaS Product Direction — Real Estate Media Operating System

## Core Vision

This booking system should become a sellable SaaS platform for real estate photographers/media companies — not just Pixel Blaster Media's internal booking site.

Think:

- Acuity-style booking simplicity
- Spiro-style real estate media business workflow
- AI-native realtor/client backend
- Persistent media/property archive
- Subscription SaaS for other photographers like Michael

Working product category/name idea:

**Real Estate Media OS**

Potential future names TBD.

---

## Who Pays

Primary customer:

- Real estate photographers
- real estate media companies
- small teams doing photos/video/drone/iGUIDE/floor plans

End users inside each customer account:

- business owner/admin
- photographers/editors
- realtor clients
- brokerages/teams

Michael/Pixel Blaster should be the first tenant and proof-of-concept customer.

---

## What It Replaces

For the media company:

- Acuity / Calendly booking
- manual Google Calendar coordination
- manual email reminders
- scattered client delivery links
- manual QuickBooks invoice creation
- spreadsheets/job tracking
- separate property website tools
- parts of Spiro-style media business software

For the realtor:

- hunting through old emails for photos/iGUIDE links
- manually writing listing copy/social captions
- asking the photographer to resend assets
- separate tools for flyers/social posts/property pages

---

## Product Pillars

### 1. Booking Engine

Simple, fast booking flow for realtors:

- packages/bundles
- a-la-carte services
- upsells/add-ons
- availability/calendar
- service area/travel fee logic
- intake questions
- confirmations/reminders

### 2. Media Company Admin

Back office for photographers:

- today’s shoots
- booking/job pipeline
- calendar
- photographer checklist
- client notes/access instructions
- deliverable status
- iGUIDE/Fotello/other integrations
- QuickBooks/invoicing
- package/pricing management

Near-term integration pipeline:

- Full Fotello upload/enhancement workflow from the admin booking page.
  Admin should upload photos on a booking, choose interior/exterior, let the app
  create/get the Fotello listing, request presigned uploads server-side, upload
  directly from the browser, start enhancement server-side, track the enhance ID,
  and publish completed photo galleries to the realtor portal via the existing
  deliverables flow. Keep `FOTELLO_API_KEY` server-only, never hard-code or log
  it, preserve manual enhance ID tracking as fallback, and avoid schema changes
  unless upload tracking becomes necessary.
- Google Places address autocomplete reliability pass. The public booking flow
  and admin calendar drawer should both return suggestions consistently. Check
  that `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is plain ASCII, has Places API (New)
  enabled, has billing enabled, and allows both production and localhost browser
  referrers. Improve the UI so API/key/referrer failures show a clear admin-safe
  message instead of only "No matches yet."

### 3. Realtor Portal

The realtor backend should be excellent and easy:

- dashboard with upcoming shoots + recent deliveries
- searchable past shoot/property library
- all deliverables preserved per property
- re-download photos/videos/floor plans
- view invoices/history
- book again/rebook similar package
- share property pages
- AI tools attached to each listing

### 4. AI Marketing Assistant

This is the “something new.”

AI should help realtors create useful marketing assets from each shoot:

- MLS/listing descriptions
- Instagram captions
- Facebook/LinkedIn posts
- email blurbs to sellers/buyers
- reel scripts
- property highlight summaries
- flyer copy
- open house promos
- agent voice/tone presets

Eventually:

- generate branded marketing kits from uploaded photos
- suggest best package before booking
- summarize previous listings/results
- answer natural-language questions like “find my last shoot on Locke Street”

### 5. Property Websites / Marketing Kits

Each completed shoot can generate:

- branded public property page
- iGUIDE embed
- photo gallery
- floor plan links
- video links
- social sharing links
- downloadable flyer/graphics


### 6. Trusted Listing Data / Board-Ready Layer

Long-term vision: become a trusted source of listing media and metadata that realtors, brokerages, and potentially real estate boards/MLS systems can rely on.

The platform should eventually be able to provide structured, verified outputs from a shoot:

- property address and core facts
- media package purchased
- verified photo gallery
- verified iGUIDE/floor plan/measurements
- public property page
- AI-assisted but human-approved listing copy
- social/marketing assets
- delivery timestamps and audit trail

Potential future integrations:

- MLS/board posting workflows
- RESO-style structured fields
- CREA/DDF-style listing data compatibility where applicable
- brokerage/team export tools
- “send to listing” handoff from realtor portal

Important: AI can assist with copy and packaging, but board/MLS-facing outputs must be realtor-approved and traceable. The product should feel trustworthy: clear source data, approval states, audit logs, and no mystery automation posting without explicit human review.

---

## SaaS Architecture Requirement

From here forward, avoid hard-coding Pixel Blaster assumptions where possible.

The app should eventually support multi-tenant organizations:

- `organizations`
- `organization_members`
- organization-scoped bookings/properties/catalog/integrations
- tenant branding: logo, colors, business name, domain/subdomain
- per-tenant integrations: Google Calendar, QuickBooks, iGUIDE, Fotello, email provider
- subscription/billing status

Pixel Blaster can stay as the first/default org while the app evolves.

Important principle:

**Build for Pixel Blaster’s workflow first, but keep the data model and product boundaries SaaS-ready.**

Do not overbuild enterprise multi-tenancy before the core workflow is solid, but do not paint the app into a single-company corner.

---

## Subscription Model Ideas

Potential pricing:

### Starter — solo photographer
- booking page
- client portal
- property library
- basic delivery
- limited AI credits

### Pro — busy solo/small team
- all Starter
- QuickBooks integration
- iGUIDE/Fotello integrations
- reminders
- marketing kit tools
- custom branding/domain
- more AI credits

### Studio — team/business
- multiple photographers
- roles/permissions
- brokerage/team clients
- advanced automations
- analytics
- priority support

Possible pricing range to validate later:

- Starter: $49–$99/mo
- Pro: $149–$249/mo
- Studio: $299+/mo

Could also charge usage-based AI/media processing credits.

---

## Near-Term Build Priority

### Phase 1 — Make Pixel Blaster version excellent

1. Realtor dashboard
2. Past shoots/property library
3. Better deliverable archive
4. Admin today’s shoots/checklist
5. Automated reminders
6. AI listing/social copy MVP

### Phase 2 — Make it SaaS-ready

1. Add organization model
2. Attach existing data to Pixel Blaster org
3. Tenant branding settings
4. Tenant catalog/pricing
5. Tenant integrations
6. Subscription status gates

### Phase 3 — Sellable SaaS

1. Public marketing site
2. Signup/onboarding
3. Stripe billing
4. Template package catalog
5. Self-serve branding
6. Documentation/help center

---

## Codex/Agent Guidance

Before major features, check this file.

Do not assume:

- only Pixel Blaster will use the app forever
- only one admin exists
- only one catalog/pricing setup exists
- only one calendar/integration account exists
- all branding should say Pixel Blaster in reusable components

Acceptable for now:

- Pixel Blaster copy/branding on public-facing first tenant pages
- single-org shortcuts where migrations can later backfill `organization_id`
- manual setup/admin-only config while validating the workflow

Avoid:

- scattering Pixel Blaster hard-coded values through core libraries
- building AI tools that only work for one user’s tone
- designing portal pages that cannot later be scoped to a tenant/org
