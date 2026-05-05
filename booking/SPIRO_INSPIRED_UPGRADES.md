# Spiro-Inspired Upgrades for Pixel Blaster Booking

These are feature ideas inspired by the real estate media workflow category Spiro is in — not a UI/content clone. Goal: keep Pixel Blaster’s booking site lean, branded, and tailored to Michael’s actual workflow.

## What the site already has

The current booking app already covers a surprising amount of the Spiro-style core:

- Public booking wizard
- Package/bundle picker
- A-la-carte services
- Conditional add-ons
- Calendar/availability
- Admin booking board
- Realtor portal
- Deliverables per property
- iGUIDE sync/webhook foundation
- Fotello gallery tracking
- QuickBooks invoicing
- Google Calendar integration

So the right move is not “clone Spiro.” The right move is to add the missing high-leverage business workflow pieces.

---

## Priority 1 — Revenue Boosters

### 1. Smart package recommendation cards

Add “Best value”, “Most popular”, and “For luxury listings” messaging to the package picker.

Purpose: guide agents toward better packages without Michael manually selling.

Suggested mapping:

- Blue Print → “Essential”
- Social Media Special → “Most popular”
- Social Media PLUS → “Best value”
- Ultimate → “Luxury / maximum exposure”

Implementation:

- Add optional fields to `catalog_items`:
  - `badge text null`
  - `highlight boolean default false`
  - `ideal_for text null`
- Surface those fields in `PackageAccordion`.
- Keep admin-editable later.

### 2. Upsell prompts based on selection

Add lightweight nudges in the booking flow:

- If photos only → suggest iGUIDE/floor plans.
- If iGUIDE only → suggest photo package.
- If video selected → reveal “Put me on camera” add-on, already partly done.
- If large sqft → recommend video/drone/Ultimate.
- If vacant → suggest virtual staging.

Implementation:

- Add a small `BookingUpsellPanel` below selected package summary.
- Generate suggestions from selected slugs + property details.
- No AI needed for v1 — deterministic rules are enough.

### 3. Travel/service-area fee estimator

Spiro advertises optional trip fees. Pixel Blaster should have this.

Implementation options:

- v1: manual distance zone selection by city/region.
- v2: Google Distance Matrix/Routes API from Michael’s home base.

Suggested rule:

- Travel included within 30 km.
- Beyond 30 km: `$0.95/km round trip`, or use configurable zones.

Fields to add:

- `travel_fee_cents` on booking request/booking
- `distance_km` nullable
- `travel_note` nullable

Admin should be able to override before invoice.

---

## Priority 2 — Time Savers

### 4. Automated booking reminders

Add email reminders for:

- Booking confirmation
- 24 hours before shoot
- Morning of shoot
- Delivery ready

Text/SMS can come later. Email first is enough.

Implementation:

- Vercel cron route checks upcoming confirmed bookings.
- Use Resend templates.
- Store reminder log table to avoid duplicate sends.

Suggested table:

```sql
booking_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  recipient_email text not null,
  unique (booking_id, kind, recipient_email)
)
```

### 5. Shoot-day checklist / photographer portal

Spiro has field workflow. Pixel Blaster should have a simple admin/mobile view:

- Today’s jobs
- Address + map link
- realtor phone/email
- services booked
- notes/access instructions
- checkboxes:
  - arrived
  - photos shot
  - iGUIDE captured
  - drone complete
  - video complete
  - uploaded to iGUIDE
  - uploaded to Fotello

This can be a mobile-friendly admin page:

`/admin/today`

No separate photographer role needed at first.

---

## Priority 3 — Delivery Polish

### 6. Property website page per listing

The realtor portal is already useful, but Spiro sells property websites. Pixel Blaster can have simple shareable listing pages.

Suggested route:

`/listing/[publicToken]`

Includes:

- hero image
- address
- iGUIDE embed
- photo gallery/Fotello embed
- floor plan download
- realtor/contact branding
- social/share links

Add `public_share_token` to properties or bookings.

### 7. Delivery email automation

When iGUIDE/Fotello deliverables are ready:

- Detect booking has ready deliverables.
- Send realtor email with portal link.
- Optionally include public property page link.

Use a delivery status to avoid repeats:

- `delivery_email_sent_at`
- `delivered_at`

### 8. Marketing kit MVP

Do not build a full design editor yet.

Start with static generated assets:

- “Just Listed” square graphic
- “Open House” square graphic
- Story/reel cover image
- PDF flyer

Inputs:

- address
- price optional
- realtor name/logo optional
- hero photo
- iGUIDE URL

Implementation:

- Server-render HTML templates to image/PDF later.
- For v1, generate HTML preview pages and downloadable PDFs.

---

## Recommended build order

### Sprint A — easiest win

1. Package badges/highlights
2. Upsell prompts
3. Travel fee note/estimator

### Sprint B — operational value

4. Automated email reminders
5. `/admin/today` shoot-day checklist

### Sprint C — client wow factor

6. Public property page
7. Delivery email automation
8. Simple marketing kit MVP

---

## Best Codex prompt

Build Sprint A first.

Requirements:

1. Add catalog item badges/highlights/ideal_for fields with migration.
2. Seed badges for the existing Pixel Blaster packages.
3. Update `PackageAccordion` to show badges and highlight the best package visually.
4. Add a deterministic `BookingUpsellPanel` in the booking wizard that recommends relevant upgrades based on selected package/service slugs and property details.
5. Add a simple travel-fee display/note in the property or confirm step: “Travel included within 30 km; outside that, travel may be added after review.” Do not calculate distance yet unless Google Distance Matrix is already configured.
6. Keep the existing booking flow and URL state intact.
7. Run `npm run typecheck` and `npm run build`.

Avoid touching the active iGUIDE API integration files unless necessary, because Codex may already be working there.
