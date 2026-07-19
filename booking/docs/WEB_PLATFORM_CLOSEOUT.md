# Pixel Blaster Web Platform Closeout

**Audit date:** July 18, 2026

**Production/source revision:** `629037646f3022c4f7a5f1fb8197d7a572f6fc98`

**Production deployment:** Vercel `READY`; `/api/health` HTTP `200`

**Purpose:** Re-baseline the July 10 booking/product audit and July 14 UI audit against current production, remove stale findings, and define the smallest finite web-platform gate before native iOS development becomes the primary focus.

---

## 1. Evidence and limitations

### Evidence used

- Current source at exact production commit `629037646f3022c4f7a5f1fb8197d7a572f6fc98`.
- Live public production at `https://pixel-blaster-media.vercel.app`.
- Vercel alias/deployment metadata and `/api/health`.
- `Pixel-Blaster-Booking-Audit-2026-07-10.md`.
- `Pixel-Blaster-UI-Audit-2026-07-14.md`.
- `booking/SAAS_PRODUCT_DIRECTION.md`.
- `booking/SPIRO_INSPIRED_UPGRADES.md`.
- Existing automated suite: **124/124 tests passed** at the pinned revision; TypeScript passed in an independent lane.
- Live non-mutating public-booking inspection at 320, 390, and 1280 px through the confirmation boundary.
- Authenticated release QA performed on July 18 covered the six Settings routes and Calendar at 320, 375, 390, 430, and 1440 px on exact reviewed candidates included in this production revision. Today, Jobs, portal, and integration conclusions are current exact-source/test evidence unless explicitly labelled live.

### Safety boundaries

- No real booking was submitted.
- No customer message, invoice, payment, provider job, or external-calendar mutation was created.
- No real customer data was edited or deleted.
- Authenticated mutation controls were not activated.

### Limitations

- Current authenticated runtime was not re-exercised for every admin and portal route at production SHA `629037646f3022c4f7a5f1fb8197d7a572f6fc98` during this read-only audit. Calendar and Settings had July 18 authenticated responsive release QA on their exact reviewed candidates now contained in this revision; Today, Jobs, and portal classifications remain source/test-qualified.
- Address-autocomplete selection was not exercised against a real property during the live pass.
- Source proves the configured Vercel schedules, not the absence of an undocumented external scheduler. Where relevant, the report says “not proven by source” rather than asserting absolute absence.
- Several current tests are structural/source regressions rather than database/provider/browser behavior. They are valuable but do not replace end-to-end release proof.

### Classification legend

- **RESOLVED:** The original defect is no longer reproducible and current evidence covers the intended behavior.
- **PARTIALLY RESOLVED:** Material work shipped, but a meaningful part of the original risk remains.
- **STILL REPRODUCIBLE:** Current source/live behavior still demonstrates the defect.
- **SUPERSEDED:** Product policy or architecture intentionally changed so the old recommendation no longer applies as written.

---

## 2. Executive assessment

The product is substantially more mature than either July audit described. The following are now strong enough to retain rather than redesign:

- Public mobile geometry and property validation.
- Calendar visual hierarchy and operational quick view.
- Settings information architecture and readiness presentation.
- Role-aware Auth routing, invitation-only company onboarding, and tenant authorization hardening.
- Today versus Jobs separation.
- Realtor property archive, deliverable access, rebooking, and published listing pages.
- Multi-tenant data model, branding, catalog, integration scoping, and controlled company setup.
- Automated regression coverage, which has grown from zero to 124 passing tests.

The platform is **not yet “finished” in the trust-and-operations sense**. The principal remaining risks are not cosmetic:

1. Public booking still commits property, booking, and line items as separate writes.
2. Calendar, invoice, email, and push side effects still lack a durable outbox/retry model.
3. Google availability still fails open on provider errors.
4. Manage-booking tokens remain cryptographically valid without expiry or per-link revocation; current booking status and shoot time still constrain mutation authority.
5. New public-booking identities are created with email pre-confirmed without mailbox proof.
6. Autoenhance reconciliation and Google watchdog routes exist but are not scheduled in Vercel.
7. Provider drift and failure state are only partially represented and not unified into an operator exception queue.

Those issues form the finite trust/correctness gate before native development becomes the primary implementation stream.

---

# 3. July 10 technical reliability re-baseline

| Original finding | Current classification | Closeout priority | Current evidence and remaining impact |
|---|---|---:|---|
| **P0 — Booking creation is not atomic** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:171-175`) | **PARTIALLY RESOLVED** | **Gate A** | Schedule overlap writes are serialized and guarded by the database (`booking/supabase/migrations/20260709193816_booking_schedule_race_guard.sql:37-90`). Auth identities created by the request have compensating cleanup on property/booking failure (`booking/app/book/actions.ts:192-207,235-250,282-307`). But property, booking, and line items remain separate writes (`booking/app/book/actions.ts:212-280,319-333`), and line-item failure is logged without rolling back the confirmed booking (`:326-333`). For an existing realtor, a property inserted at `:212-253` can also remain orphaned when booking insertion fails because property cleanup at `:282-294` is limited to request-created identities. A booking can still exist without reliable frozen pricing rows, and failed booking insertion can leave property residue. |
| **P0 — External side effects need a durable outbox** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:177-206`) | **STILL REPRODUCIBLE** | **Gate A** | Booking commits before QuickBooks, Google Calendar, email, and push (`booking/app/book/actions.ts:259-308,337-533`). Best-effort failures are logged; email result objects are not converted into durable retry work. No outbox/integration-job table is represented in current source. A “successful” booking can permanently miss calendar, invoice, confirmation, admin notice, or push effects. |
| **P0 — No automated test suite** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:208-220`) | **RESOLVED** | — | `booking/package.json:6-17` includes test and typecheck scripts; 12 test files currently execute **124 passing tests**. Residual P2: no CI workflow was found, and important tests remain structural rather than transactional/provider/browser behavior. |
| **P1 — Calendar failure fails open** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:222-230`) | **STILL REPRODUCIBLE** | **Gate A** | `booking/lib/booking/availability.ts:229-265` explicitly returns no Google busy windows after provider failure. Token expiry, permission drift, timeout, or provider outage can make busy time appear bookable. |
| **P1 — Autoenhance reconciliation not scheduled** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:232-236`) | **STILL REPRODUCIBLE** | **Gate A** | A protected bounded route exists (`booking/app/api/cron/autoenhance-sync/route.ts:7-35`) and workflow polling exists, but `booking/vercel.json:9-14` schedules reminders only. Missed webhooks can leave work waiting indefinitely without manual/external invocation. |
| **P1 — Integration drift not explicitly tracked** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:238-252`) | **PARTIALLY RESOLVED** | **Gate A** | Google diagnostics now cover source configuration, scopes, free/busy, and availability (`booking/lib/integrations/google-calendar/health-check.ts:69-189`). The watchdog route is secret-protected but default-tenant-only (`booking/app/api/cron/google-calendar-health/route.ts:17-71`) and unscheduled in Vercel. Autoenhance/iGUIDE retain workflow-local status, but there is no unified provider state/retry/exception model. |
| **P2 — Toronto hard-coded globally** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:254-258`) | **STILL REPRODUCIBLE, ACCEPTED BETA LIMIT** | **Later** | Calendar and availability use a global Toronto timezone. This is acceptable for Pixel Blaster’s private operator alpha, but must become organization-owned before broad SaaS or cross-timezone native rollout. |

## Reliability conclusion

The original “zero tests” P0 is closed, and slot-race protection is materially stronger. The aggregate booking transaction, durable side effects, and degraded calendar behavior remain the central trust risks.

---

# 4. July 10 security/privacy re-baseline

| Original finding | Current classification | Closeout priority | Current evidence and remaining impact |
|---|---|---:|---|
| **P0 — Manage-booking links do not expire** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:264-274`) | **STILL REPRODUCIBLE** | **Gate A** | Tokens remain `bookingId.HMAC(bookingId)` (`booking/lib/booking/manage-token.ts:9-37`). Verification has no issued-at, expiry, nonce, or per-link database revocation (`:39-64`). Mutation is constrained to requested/confirmed, scheduled, future bookings (`booking/app/book/manage/[token]/actions.ts:81-94`), so cancelled, later-stage, unscheduled, and past bookings are denied. The token nevertheless remains cryptographically valid indefinitely for any booking that still satisfies those state/time rules. Signing also falls back to `SUPABASE_SERVICE_ROLE_KEY` when `BOOKING_MANAGE_SECRET` is absent (`booking/lib/booking/manage-token.ts:13-26`), coupling link rotation to a much broader credential unless a dedicated secret is configured. |
| **P1 — Integration credentials stored as plaintext JSONB** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:276-280`) | **STILL REPRODUCIBLE, BETTER ISOLATED** | **Gate B / pre-SaaS** | Database-stored provider secrets are persisted without application-level field encryption: integration credentials use JSONB (`booking/supabase/migrations/0012_integration_credentials.sql:17-22`; `booking/lib/integrations/credentials.ts:137-162`), while QuickBooks (`booking/supabase/migrations/0005_quickbooks.sql:22-35`) and Google Calendar (`booking/supabase/migrations/0010_google_calendar.sql:15-30`) connection tables retain OAuth access/refresh tokens. July hardening removed ordinary authenticated-browser policies from credential/token tables (`booking/supabase/migrations/20260716183000_emergency_tenant_authorization_hardening.sql:174-201`), reducing exposure, but a backup/service-role/database compromise still exposes those secrets. Encryption or vault references must cover both credential JSONB and OAuth tokens before sellable SaaS. |
| **P1 — Email considered confirmed without proving ownership** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:282-286`) | **STILL REPRODUCIBLE** | **Gate A** | New public-booking accounts are created with `email_confirm: true` (`booking/app/book/actions.ts:764-772`; `booking/lib/auth/provision-realtor.ts:45-56`). Existing accounts require password authentication, but for a previously unused address a visitor can choose a password, receive an authenticated session, and control the new portal identity associated with another person’s email (`booking/app/book/actions.ts:764-830`). |
| **P1 — Excessive customer detail copied into Google Calendar** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:288-292`) | **STILL REPRODUCIBLE** | **P1 privacy / Gate B** | Event title/location/description include realtor identity, email, phone, address, services, occupancy, basement, and notes, and the realtor may be added as attendee (`booking/app/book/actions.ts:371-414`). Reduce to operational minimum and make attendee behavior explicit. |
| **P2 — iGUIDE webhook secret in URL** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:294-296`) | **PARTIALLY RESOLVED** | **Gate B** | The webhook now fails closed, bounds payload size, resolves tenant credentials, and compares fixed-size digests (`booking/app/api/integrations/iguide/webhook/route.ts:40-66,101-145`). The credential is still transported as `?secret=`, exposing it to URL logs/telemetry and copied webhook URLs. |
| **Public signup / tenant authority concerns added after the audit** | **RESOLVED FOR INVITE-ONLY BETA** | — | Public Supabase signup is disabled; company access is membership-derived and fail-closed; company onboarding is platform-invited; self-promotion and cross-tenant policy leakage are blocked by July hardening migrations and regression tests. Keep independently verifying hosted signup state during security releases. |

---

# 5. July 10 public UX re-baseline

| Original finding | Current classification | Evidence and remaining work |
|---|---|---|
| **UX-01 — Property form silently refuses to continue** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:77-89`) | **RESOLVED** | Persistent summary, inline errors, `role="alert"`, first-invalid focus, and smooth reveal exist at `booking/app/book/property/PropertyForm.tsx:99-123,153-177`. Live incomplete submission reproduced the intended alert/focus behavior without mutation. |
| **UX-02 — Required fields unclear** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:91-95`) | **RESOLVED / PARTLY SUPERSEDED** | Address and city are explicitly required (`PropertyForm.tsx:165-198`). Square footage is optional and explains its iGUIDE pricing effect (`:206-224`). Occupancy and basement no longer block advancement, so the old “functionally required but unmarked” defect no longer applies. |
| **UX-03 — Autocomplete copy contradictory** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:99-101`) | **RESOLVED IN SOURCE** | Free typing is accepted by current validation; selected suggestions produce “Address selected” rather than stale “no matches” (`booking/app/_components/AddressAutocomplete.tsx:431-462`). Real suggestion selection was not re-exercised in production. |
| **UX-04 — Package selection too long** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:103-113`) | **PARTIALLY RESOLVED** | Shared inclusions are shown once, package badges/“Best for” guidance exist, and a sticky running total remains. Repeated square-footage and measuring/overage prose still makes each package card long (`booking/app/book/_components/PackageAccordion.tsx:148-170,241-262`). |
| **UX-05 — Trust and purchase details thin** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:115-129`) | **PARTIALLY RESOLVED** | Confirmation now states payment-after-shoot and travel review (`booking/app/book/confirm/page.tsx:220-224`). CAD/tax, turnaround, cancellation/rescheduling, weather/drone, help/privacy, and the final button’s binding meaning are not yet presented as one concise policy block. |
| **UX-06 — Accessibility semantics** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:131-138`) | **PARTIALLY RESOLVED** | Validation announcement/focus is fixed, interactive package controls are keyboard-operable, and current responsive geometry passes. Preserve and extend behavioral checks for progress semantics, heading order, fieldset announcements, visible focus, and native control semantics. |
| **UX-07 — Too much intake before availability** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:140-142`) | **PARTIALLY RESOLVED** | Optional shot requests/access notes are collapsed (`PropertyForm.tsx:286-309`), and occupancy/basement no longer block. The flow still requires the property step before availability and defaults to the full-month scheduler rather than “Next available.” |
| **UX-08 — Ambiguous basement choice** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:144-146`) | **STILL REPRODUCIBLE** | “No basement / skip it” still combines “none exists” with “exists but do not shoot” (`PropertyForm.tsx:261-283`). Split into No basement / Include / Skip. |
| **Low-priority terminology/polish** (`Pixel-Blaster-Booking-Audit-2026-07-10.md:148-155`) | **PARTIALLY RESOLVED** | Many labels and Auth surfaces are cleaner. Continue normalizing Blueprint, iGUIDE, sq ft, duration, phone formatting, policy copy, and stale “Bookings” labels as bounded P2 cleanup. |

---

# 6. July 14 UI/product re-baseline

## Public booking

| July 14 finding/recommendation | Status | Current assessment |
|---|---|---|
| **Mobile horizontal-overflow P0** (`Pixel-Blaster-UI-Audit-2026-07-14.md:112-122`) | **RESOLVED** | Correct mobile emulation and DOM geometry at 320/390 px across packages, property, schedule, and confirmation returned `scrollWidth === innerWidth` with no visible out-of-bounds element. Current layout includes explicit viewport metadata. Preserve this with rendered browser tests. |
| Shrink hero, reduce package repetition, progressive comparison (`Pixel-Blaster-UI-Audit-2026-07-14.md:133-143`) | **PARTIAL** | Hero and package presentation improved; common inclusions and recommendations are consolidated. Per-card measuring/overage copy remains repetitive. |
| Property structure and persistent validation (`Pixel-Blaster-UI-Audit-2026-07-14.md:145-175`) | **RESOLVED** | Required facts are grouped, optional requests are collapsed, and persistent validation/focus is implemented. Basement semantics still need separation. |
| Replace default month with Next available (`Pixel-Blaster-UI-Audit-2026-07-14.md:177-197`) | **OPEN** | The month scheduler remains the default. This is the largest remaining booking-flow efficiency opportunity after trust work. |
| Put confirmation summary before upsells (`Pixel-Blaster-UI-Audit-2026-07-14.md:199-216`) | **RESOLVED** | Live confirmation showed booking facts before recommendations. Residual P2 duplication remains: address heading + address row and repeated bottom total. |

## Admin information architecture

| July 14 finding/recommendation | Status | Current assessment |
|---|---|---|
| Align mobile/desktop navigation; remove duplicated mobile destinations (`Pixel-Blaster-UI-Audit-2026-07-14.md:222-239`) | **RESOLVED** | Primary navigation is Today, Calendar, Jobs, Realtors; secondary tools are in the avatar menu; mobile and desktop roles are coherent. |
| Make Today exceptions-first (`Pixel-Blaster-UI-Audit-2026-07-14.md:241-251`) | **PARTIAL** | Today is a useful mobile shoot-day command surface with route, weather, jobs, notes, deliverable state, and AI brief. It lacks one unified persisted exception queue and mutable field checklist. |
| Compact Calendar quick view (`Pixel-Blaster-UI-Audit-2026-07-14.md:253-266`) | **RESOLVED** | Quick view now prioritizes address/client/services, warning state, Open job, Directions, Call, collapsed rescheduling, and secondary details. Mobile bottom-nav clearance is preserved. |
| Separate Today / Calendar / Jobs; include unscheduled requested work (`Pixel-Blaster-UI-Audit-2026-07-14.md:268-280`) | **RESOLVED** | Jobs is lifecycle-oriented and includes/prioritizes unscheduled work; Today is day execution; Calendar is time. Residual terminology: booking detail still links “← Bookings.” |
| Simplify booking workspace header and status-aware next action (`Pixel-Blaster-UI-Audit-2026-07-14.md:282-298`) | **PARTIAL** | The workspace supports Media, Website, Delivery, Billing, Details, lifecycle transitions, rescheduling, and cancellation. A single authoritative next-action model/progress rail is not consistently demonstrated. |
| Move realtor editing out of expanding list cards (`Pixel-Blaster-UI-Audit-2026-07-14.md:300-309`) | **OPEN / P2** | Retain for later operator-efficiency work unless current field use shows measurable friction. It is not a native-app blocker. |
| Reposition AI as contextual assistant (`Pixel-Blaster-UI-Audit-2026-07-14.md:311-321`) | **PARTIAL TO RESOLVED** | AI no longer owns a primary mobile tab and is integrated into Today/booking/calendar contexts. Continue requiring confirmations, bounded actions, and clear undo/audit behavior. |
| Warm Operational Precision / fewer nested panels (`Pixel-Blaster-UI-Audit-2026-07-14.md:325-344`) | **PARTIALLY RESOLVED** | Calendar and Settings now follow the intended hierarchy; the system still needs a documented shared design-system contract and progressive flattening rather than global redesign. |

## July 14 phase summary

- **Phase 1 high-impact cleanup:** mostly complete. Remaining: package-card prose, basement semantics, policy copy, booking-detail action hierarchy, terminology normalization.
- **Phase 2 design-system consolidation:** partial. Navigation and Jobs purpose are resolved; shared rendered browser tests, realtor profile workspace, and a documented token/component contract remain.
- **Phase 3 workflow redesign:** open/partial. “Next available,” unified exception queue, status-aware job action, and post-booking email verification are the meaningful remaining items.

---

# 7. Current product/workflow readiness

## Ready or substantially implemented

- **Booking:** tenant catalog, pricing/duration, availability, intake, slot race check, confirmed booking, property reuse, line snapshots, calendar/email/push/invoice integration, and portal handoff (`booking/app/book/actions.ts:63-190,212-333,337-548`).
- **Calendar:** bookings, manual blocks, business hours, multiple Google sources, quick view, direct shoot creation, drag rescheduling, undo payload, and sync warnings (`booking/app/admin/calendar/page.tsx:128-198,228-365`; `booking/app/admin/calendar/actions.ts:145-350,383-600`).
- **Jobs:** tenant-scoped lifecycle board, search/status filters, unscheduled work, workspace tabs, status transitions, media, website, delivery, billing, reschedule, and cancellation (`booking/app/admin/bookings/page.tsx:26-71,81-184`; `booking/app/admin/bookings/[id]/page.tsx:285-493,508-676`).
- **Portal/property archive:** active/archived properties, downloads, iGUIDE, video, invoices, rebooking, and listing-page editor (`booking/app/portal/page.tsx:53-106,129-245`; `booking/app/portal/[propertyId]/page.tsx:95-175,241-288,447-811`).
- **Property websites:** published listing routes with selectable templates, galleries, embeds, agent CTA, and publication control (`booking/app/listings/[slug]/page.tsx:70-124,137-220,222-342,508-683`).
- **Settings/company setup:** operator-first IA, tenant branding, booking setup, provider readiness, controlled owner invitation, and permission-gated platform administration.
- **Tenant foundation:** organization scope, memberships, RLS hardening, tenant-qualified provider IDs, credential isolation from ordinary browser sessions, and invite-only beta onboarding.

## Partially implemented

- **Today:** strong daily field view with route, contact, notes, weather, deliverable state, and deep links (`booking/app/admin/today/page.tsx:82-180,278-495,619-665,874-960`), but no persisted arrived/captured/uploaded checklist and no unified integration/delivery exception queue.
- **Delivery:** validates ready media and records uniquely keyed notification rows after successful send (`booking/app/admin/bookings/[id]/actions.ts:824-971`), but send and persistence are separate operations, so concurrent calls or post-send persistence failure can still duplicate delivery. Delivery remains operator-triggered rather than automatically queued from a defined readiness rule.
- **Reminders:** confirmation/day-before/delivery exist; a complete configurable sequence and explicit failure queue do not.
- **Integration operations:** broad provider support exists, but worker scheduling, replay, drift state, and tenant-wide diagnostics are uneven.
- **SaaS:** tenant model and controlled onboarding exist; subscriptions, entitlements, quotas, dunning, offboarding/export/delete, and multi-company identities do not. Those are intentionally not web-closeout requirements for the operator app.

## Open but intentionally not required before operator-app work

- Public SaaS signup and marketing site.
- Stripe subscription billing and entitlements.
- Full marketing-kit generator and AI listing/social copy.
- Team resource scheduling.
- Public App Store distribution.
- Full realtor/client native app.

---

# 8. Finite web closeout gate before native iOS implementation

## Gate A — Must close before native becomes the primary build stream

1. **Atomic booking aggregate**
   - Commit property reuse/create, booking, line-item snapshots, and initial consequential side-effect jobs in one transaction/RPC.
   - Prevent both confirmed bookings without line snapshots and orphan properties for existing accounts.
   - Ship rollback, idempotency, concurrent-slot-conflict, and partial-residue tests with this work.

2. **Durable external work for the exercised Pixel Blaster lifecycle**
   - Add tenant-scoped outbox/integration jobs for booking-triggered Calendar, invoice, confirmation/admin email, and push work, plus provider processing jobs that are already automatic.
   - Add idempotency keys, bounded exponential retry, terminal state, replay, correlation IDs, and operator-visible exceptions.
   - Automatic customer delivery is not required until the delivery-readiness policy in Gate B is approved; when delivery is invoked, send/persistence must still be duplicate-safe and recoverable.
   - Ship retry, duplicate-delivery, post-send-persistence-failure, and replay tests with this work.

3. **Safe degraded availability**
   - Use bounded last-known-good busy state or mark uncertain slots as “request this time.”
   - Alert once with actionable provider context; never silently convert provider failure into free time.
   - Ship timeout, expired-token, missing-scope, stale-cache, and recovery tests with this work.

4. **Expiring/revocable manage authorization**
   - Add issue time, expiry, purpose, per-link nonce/hash, and revocation/rotation while preserving current booking-status/time checks.
   - Configure a dedicated signing secret; never rely on service-role-key rotation for ordinary link invalidation.
   - Ship expired, revoked, replayed, wrong-purpose, wrong-booking, past-booking, and later-status tests with this work.

5. **Mailbox ownership after frictionless booking**
   - Do not treat an unverified address as confirmed identity authority or install a privileged portal session for an unproved mailbox.
   - Preserve low-friction booking, then require a mailbox-bound magic link to claim portal access.
   - Ship first-use, existing-account, wrong-mailbox, abandoned-claim, and committed-booking/session-installation tests with this work.

6. **Schedule consequential workers for the Pixel Blaster beta tenant**
   - Schedule Autoenhance reconciliation and Google health monitoring with bounded batches and alerts for the currently exercised tenant.
   - Keep all-tenant watchdog expansion as a sellable-SaaS milestone rather than a blocker for the operator app.
   - Ship authorization, timeout, overlap prevention, failure alerting, and recovery tests with the schedules.

7. **Final behavioral release proof**
   - Add rendered browser coverage for all four public stages at 320–430 px.
   - Add CI that runs tests, typecheck, lint, and production build.
   - Exercise one production-shaped Pixel Blaster lifecycle and one two-tenant isolation lifecycle using synthetic exact-ID fixtures with zero-residue cleanup.

## Gate B — Ordered product/security tightening that may overlap native API design

| Order | Work item | Owner lane | Dependency | Acceptance / milestone |
|---:|---|---|---|---|
| 8 | Split basement semantics into **No basement / Include / Skip**. | Product UX | None | Three distinct stored/displayed meanings; booking review and admin detail preserve the distinction. |
| 9 | Finish package-card deduplication and add one concise policy/trust block. | Product UX | None | Common measuring/pricing prose appears once; CAD/tax, payment, turnaround, cancellation, weather/drone, travel, help/privacy, and final-action meaning are concise and noncontradictory. |
| 10 | Replace the default monthly scheduler with **Next available**, retaining full Calendar as secondary. | Scheduling UX | Gate A degraded-availability policy | First useful slots appear without month scanning; full Calendar remains accessible; rendered mobile tests pass. |
| 11 | Define one Today exception queue and explicit delivery-readiness rule. | Operations | Gate A outbox state | Failed/retrying/terminal work and ready-to-send delivery appear once with one safe next action. Automatic delivery remains deferred until Michael approves the readiness policy. |
| 12 | Make booking-workspace next action status-aware and normalize Jobs terminology. | Operations UX | Delivery-readiness rule | One primary action matches lifecycle state; secondary actions remain available; stale Bookings labels are removed where Jobs is the product term. |
| 13 | Move iGUIDE webhook authentication out of query-string transport. | Security/integrations | Provider compatibility check | Header/signature authentication is verified, replay/duplicate behavior is tested, and secrets no longer enter URLs/logs. |
| 14 | Minimize Google Calendar PII. | Privacy/integrations | Operational-field decision | Event payload contains only approved operational minimum; attendee behavior is explicit and tested. |
| 15 | Document the final web/native design system. | Product design | Approved web closeout surfaces | Shared palette, typography, spacing, radius, status, sheet, navigation, focus, and mobile/desktop principles are durable and implementable in SwiftUI. |
| 16 | Add field encryption or vault references for all database-stored provider secrets. | Security/platform | Secret-store design | Credential JSONB and OAuth access/refresh tokens are protected with rotation/recovery. **Milestone: required before sellable SaaS, not before the private operator-app slice.** |

## Exit criteria

The platform is ready for native implementation to become primary when:

- Gate A is complete and independently verified.
- No known P0 or release-blocking P1 remains in the exercised Pixel Blaster booking-to-delivery lifecycle.
- Gate B follows the assigned order above; items explicitly marked pre-SaaS may remain deferred and no other item blocks the first native read-only vertical slice.
- One production-shaped Pixel Blaster lifecycle and one two-tenant isolation lifecycle have been exercised with synthetic data and exact-ID zero-residue cleanup.
- Current limitations are stated truthfully: invite-only, Toronto timezone, no public SaaS subscription lifecycle, operator app first.

---

# 9. Native API design that can proceed in parallel

Do not build native screens against Server Components or scraped pages.

## First read-only vertical-slice prerequisites — design in parallel with Gate A

1. Versioned DTOs for Today, Calendar, Jobs, booking detail, properties, contacts, deliverables, and integration/degraded state.
2. Bearer-token authentication with server-derived tenant and role authority; never trust a device-supplied organization ID.
3. Stable App Entities and deep links for booking/appointment, job, property, and realtor.
4. Tenant timezone/calendar policy in every relevant response.
5. Protected media-download contracts for any media shown in the first slice, using expiring/proxied authorization rather than durable provider URLs.
6. Stable read-side error taxonomy and correlation IDs for provider drift, missing authority, and unavailable data.

## Later native capabilities — not prerequisites to begin the read-only slice

7. Idempotent command endpoints with optimistic versioning/conflict responses for status updates, notes, reschedule, checklist, and delivery readiness.
8. Offline/delta synchronization using stable update cursors, tombstones, and conflict semantics.
9. APNs device registration, rotation, logout cleanup, privacy-safe payloads, and deep links.
10. Background-job/exception endpoints exposing pending, retrying, terminal, and replayable work.

Read-only Siri/App Intents remain a committed product goal, but they follow the dependable Today/Calendar/Job vertical slice rather than preceding it. Customer-impacting mutations remain confirmation-gated and server-authorized.

---

# 10. Recommended implementation order

**Parallel from the start:** define the first-slice native read DTO, bearer-authority, entity/deep-link, timezone, protected-media, and error contracts without building production native screens yet.

1. Atomic booking aggregate and its rollback/concurrency tests.
2. Durable booking/provider side effects and their retry/duplicate tests.
3. Safe degraded Calendar availability and failure/recovery tests.
4. Manage-link expiry/revocation/dedicated-secret work and mailbox ownership.
5. Schedule Pixel Blaster workers and expose unified exception state.
6. Add rendered booking-flow tests, CI, and final synthetic lifecycle proof.
7. Complete basement, package, and policy copy cleanup.
8. Ship Next available after the degraded-availability policy is stable.
9. Define Today exception/delivery readiness, then status-aware Jobs actions and terminology.
10. Replace iGUIDE query-string authentication.
11. Minimize Google Calendar PII.
12. Finalize the web/native design-system contract.
13. Create the SwiftUI repository and first read-only vertical slice after Gate A passes.
14. Complete provider-secret encryption/vaulting before sellable SaaS expansion.

This order closes the highest-cost failure modes first, gives every deferred item an explicit milestone, starts native contract work without duplicating unstable behavior, and preserves the UI work already approved.
