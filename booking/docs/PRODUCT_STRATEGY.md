# Pixel Blaster Product Strategy

## Product category

Pixel Blaster is the **listing-readiness, media-production, approval, release, and publishing command centre** for real-estate media.

It is not another generic booking calendar, CRM, gallery, or property-site builder. Those are required table stakes, but they are not the durable reason photographers subscribe or realtors request the platform.

## Production status and safety

Pixel Booking is actively used for Pixel Blaster business operations and client work today. New capabilities must preserve the current booking, calendar, invoicing, iGUIDE, delivery, realtor portal, and listing-page workflows until a replacement path has been separately verified.

**No destructive migration, deletion, or irreversible cutover is permitted as an ordinary implementation shortcut.** Additive migrations, compatibility reads, tenant-scoped feature flags, exact-data backfills, supervised pilots, and measured retirement windows are the default. Existing customer records and deliverables remain intact. A legacy field or route may be retired only after all callers are inventoried, migrated, monitored at zero supported use, and an explicit rollback-safe release approves removal.

## Primary buyer

- Solo photographers
- Real-estate media companies
- Small and mid-sized photography teams
- Brokerage-approved media vendors and brokerage operations teams

## End users

- Photography business owners and administrators
- Photographers, videographers, drone operators, floor-plan technicians, and editors
- Realtors and realtor teams
- Brokerage operations, procurement, marketing, and finance staff

## Complete workflow

```text
Book → coordinate → verify access/readiness → capture → upload → edit
→ QC → revise → approve → package → release → publish → verify
→ invoice → report → archive/reuse
```

## Realtor pull

Realtors should ask photographers to use Pixel because it provides:

- verified property access and shoot readiness;
- one accepted shot brief and scope record;
- a shared listing timeline;
- structured revision requests with visible resolution;
- full-resolution and destination-ready downloads;
- branded and MLS-safe listing pages from the same approved release;
- confidence that the correct version reached each authorized destination;
- a reusable property media archive independent of old emails and expiring vendor links.

## Photographer pull

Photographers should pay for Pixel because it provides:

- high-conversion booking, package guidance, and relevant upsells;
- constraint-aware scheduling, field workflow, and exception recovery;
- provider-neutral editing orchestration;
- fewer missing files, revisions, disputes, and manual delivery tasks;
- pay-before-release, invoicing, and client activity evidence;
- editor/provider cost, quality, latency, and SLA visibility;
- client retention and brokerage relationships;
- a credible SaaS workflow without assembling multiple disconnected tools.

## Product principles

1. **Property identity is immutable.** Bookings, assets, versions, revisions, releases, pages, invoices, and destination receipts bind to one tenant-qualified property identity.
2. **Provider URLs are transport, never truth.** Pixel ingests, validates, checksums, and owns released media when contracts permit.
3. **Masters never mutate.** Corrections create versions. Approval binds an immutable release manifest.
4. **MLS rules are destination- and version-specific.** Unknown required values fail closed; provisional profiles are labelled honestly.
5. **Human approval gates material property changes.** No generative edit auto-publishes.
6. **Webhooks are hints.** Reconciliation reads authoritative provider state.
7. **Multi-tenant commercial rights are a release gate.** API access alone does not establish OEM, resale, privacy, or processing rights.
8. **Sent is not live.** Publication states distinguish prepared, submitted, accepted, verified live, mismatch, removed, unknown, unsupported, and error.
9. **Mobile is a first-class workflow.** Normal realtor delivery cannot depend entirely on desktop ZIP extraction.
10. **Build differentiation; buy infrastructure.** Pixel owns workflow, policy, release semantics, tenant isolation, and audit evidence while using managed storage, codecs, communications, and payments.
11. **Exceptions are product objects.** Access, weather, reshoots, missing outputs, QC failures, revisions, unpaid releases, rights expiry, and publish mismatches have owners, SLAs, and recovery paths.
12. **Production is fail-closed.** Schema, credentials, external side effects, ambiguous outcomes, and cross-tenant ownership are never guessed.

## Differentiating product wedges

1. Verified property-access and shoot-readiness handoff
2. Living shot brief and explicit scope acceptance
3. Structured revisions, rush requests, and change orders
4. Constraint-aware scheduling and exception recovery
5. Objective editing QC and gallery reconciliation
6. MLS-safe, destination-specific release packs
7. Shared listing timeline and immutable property identity
8. Relationship-aware payment and release policies
9. Publish-and-verify distribution
10. Editor/vendor performance and SLA tracking
11. Brokerage standards, budgets, consolidated billing, and vendor portability

## Product pillars

### Booking and revenue

Fast branded booking, packages, add-ons, service area, availability, travel, intake, recommendations, deposits, reminders, and conversion analytics.

### Operations

Today command centre, assignment, route/readiness context, field checklist, provider workflow, exceptions, SLAs, invoicing, payouts, and cost visibility.

### Canonical media and release

Secure provider ingestion, immutable masters, versioned derivatives, QC, revisions, approvals, reproducible full-resolution and destination packages, revocable delivery, and audit history.

### Realtor property workspace

Shared timeline, delivery gallery, individual and bulk downloads, proofing, revisions, payment state, listing pages, marketing assets, analytics, and durable archive.

### Publishing and compliance

Versioned destination profiles, branded and MLS-safe policies, human approvals, distribution receipts, reconciliation, mismatch detection, takedown, and rights expiry.

### Brokerage operating layer

Approved vendors, standards, budgets, purchase authorization, consolidated billing, policy enforcement, portable assets, and cross-provider release governance.

### SaaS platform

Invite-only onboarding before self-serve scale, tenant branding, catalog, integrations, entitlements, billing, import/export, readiness diagnostics, support tools, and isolated operations.

## North star

**Percentage of listing releases completed and verified without operator intervention.**

Supporting measures:

- time from final provider output to realtor-approved release;
- first successful download time by device/browser;
- support contacts per 100 deliveries;
- revision rounds and revision cycle time;
- wrong-version and branding escape rate;
- false “Verified live” count, with a target of zero;
- active agents who request Pixel from another photographer;
- booking conversion and average order value;
- on-time shoot and delivery SLA rate;
- editing cost, latency, failure, and rework by provider;
- expired or revoked links still accessible, with a target of zero;
- qualified lead conversion by source;
- net revenue retention by photographer/company tenant.

## Do not lead with

- generic “all-in-one” positioning;
- a prettier gallery;
- another CRM;
- AI captions or listing descriptions alone;
- property-site templates without release control;
- raw page-view dashboards;
- favourites and comments alone;
- universal MLS compliance;
- “published” without destination-specific verification;
- accessibility claims without continuous behavioral evidence.

## Product roadmap order

1. Freeze product and media security contracts.
2. Establish Pixel-owned immutable media and release infrastructure.
3. Deliver a mobile-safe realtor gallery with reproducible full-resolution and destination packages.
4. Add structured revision, approval, payment, and technical QC.
5. Normalize editing providers behind one adapter contract.
6. Productize property readiness, shot briefs, change orders, and exceptions.
7. Bind branded and MLS-safe listing pages to approved releases.
8. Add destination policies and truthful publish verification.
9. Add the brokerage operating layer.
10. Complete SaaS onboarding, billing, import, readiness, and support tooling.

## Success standard

Pixel can claim category leadership only when:

- another photography business can onboard without platform-owner intervention;
- a realtor can book, prepare, approve, download, and publish from one property timeline;
- editing providers can change without changing the client workflow or losing media identity;
- each delivered file has provenance, version, checksum, profile, and approval evidence;
- full-resolution and destination-specific packages are reproducible;
- revoked or withdrawn releases stop future authorized access within the documented SLA;
- branded and MLS-safe outputs use the same approved release;
- destination state truthfully distinguishes sent from verified live;
- exceptions have ownership and recovery;
- cross-tenant isolation and provider routing are behaviorally proven;
- the product measurably reduces support and revision effort while increasing realtor repeat preference;
- storage, providers, workers, support, and compliance operate at sustainable margins.

Feature count does not make the best product. Reliable listing-release outcomes do.
