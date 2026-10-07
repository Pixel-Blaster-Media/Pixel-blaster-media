# Studio Workspace admin review

The approved Studio Workspace direction is implemented for review. The admin now uses the booking page’s warm surfaces, charcoal text and teal accents, with persistent desktop navigation and a compact mobile navigation bar. Today, Bookings, the booking editor and Calendar share the same shell.

This is a draft implementation. No deployment, migration, production booking, email, payment or settings change was made during this work.

## What changed

- Today gives the real daily shoot count, confirmed count and shot/editing count, with an accessible booking link on every card. Existing private notes, route links, brief preferences and operational tools remain available.
- Bookings retains the tenant-scoped search RPC, status filters, cursor pagination and cancel action. Desktop rows become readable cards on smaller screens.
- Details puts the edit form first and groups it into Property, Shoot & services, and Realtor & notes. All existing field names, pricing rules, retained inactive selections and explicit confirmation-email opt-in are preserved. Failed or interrupted saves keep entered values and the same request ID; only acknowledged saves advance the draft version. Discard explicitly accepts the current server snapshot.
- Desktop navigation includes Today, Bookings, Calendar, Realtors and Inbox. Assistant, iGUIDE, Settings and sign-out remain available; mobile exposes secondary destinations under More. Keyboard focus, a skip link and Escape dismissal are included.
- Calendar defaults to a continuous horizontal timeline. Native scrolling moves between adjacent weeks and vertically through hours. Shift-wheel, Page Up/Page Down and Today/Home are supported. Day and agenda views, search, calendar sources, hours, quick view, mouse drag, creation and rescheduling retain their existing actions.

## Speed: evidence and limits

The previous Today route awaited every weather lookup before returning useful content. The new route returns the bookings and streams each forecast through a Suspense boundary. An isolated test holds weather unresolved and observes the booking address and loading placeholder in the first response, then observes the completed forecast after release. A five-second overall deadline covers credential lookup, geocoding and forecast; failure shows “Forecast unavailable.” The original forecast timezone and cache policies remain intact. Independent notes, deliverables and preferences now load concurrently.

Previously, all booking tabs waited for media provider flags, iGUIDE information, website information, catalog data, private notes, delivery history and portal credentials. Optional work now runs only for its relevant tab. Behavioral tests verify actual dependency calls for Media, Website, Delivery, Details and the billing alias. Shared booking/readiness information remains available, and authentication still happens first.

The calendar loads one authenticated, tenant-scoped week per request, with private/no-store responses, request deduplication, cancellation, a 15-second client timeout, a retry state and a maximum of seven rendered weeks. It starts with the current week and preloads its two neighbors. Loading or prepending a week preserves the visible date and vertical position. This improves navigation continuity but adds bounded adjacent-week reads. Initial server calendar loading still depends on the existing availability and Google data pipeline; live latency there has not been measured.

Earlier read-only public checks measured a median booking-page HTML TTFB of 342 ms (311–360 ms across three samples) and median total response time of 529 ms (510–1112 ms). A signed-out admin redirect took approximately 319 ms to first byte and 324 ms total. These measurements do not establish authenticated admin performance. No live authenticated admin trace, Lighthouse score or production speedup percentage is claimed.

## Review evidence

The screenshot fixture renders the actual Today and Bookings server pages, the actual full Details page with its interactive editor, and the actual calendar and navigation components. Providers and actions are replaced only inside the test harness with fictional data. Browser requests outside loopback are blocked. It is a local Chromium review on Mike’s Mac mini, not a production or logged-in customer session.

Verification includes desktop (1440 px), tablet (768 px) and phone (390 px) layouts; automated WCAG A/AA checks; native wheel and emulated touch scrolling; failed week/retry behavior; bounded calendar growth; duplicate/missing event checks; retained scroll position; keyboard navigation; save failure/retry/version behavior; email opt-in; dirty-link confirmation; discard; search; and mobile menu focus. The exact results are recorded in the PR and review report.

The palette matrix uses actual route shells to check default, custom and failed-brand-loading states. The admin teal override is scoped to the known default organization. Public booking, realtor portal and other organizations’ primary palettes are preserved.

## Review sequence before release

1. Review the actual desktop and phone screenshots and exercise the local sample-data preview.
2. Use an authenticated non-production environment with representative data to verify all integrations, notifications, concurrent editing, cancellation, uploads and real availability end to end. Test a physical iPhone/Safari session, especially the editor with the keyboard open and calendar touch scrolling.
3. Record authenticated cold and warm timings for Today, each booking tab and initial/adjacent calendar loads. Compare useful-content time, navigation time and request waterfalls; optimize remaining measured bottlenecks rather than guessing.
4. Obtain release approval before deployment. This branch does not add or change database migrations.

Ordinary link navigation and browser unload warn about a dirty or pending editor. In-app browser-history navigation is not claimed to provide durable draft recovery. The retained server concurrency/version checks remain the authority for saves.

## Reproducing the local review

From the app directory, run `node tests/studio-workspace.browser.mjs` for the browser checks, or append `--serve` for the fictional-data preview. The preview opens on Mike’s Mac mini at `http://127.0.0.1:8766/admin/today`; it is not a public share URL. `STUDIO_REVIEW_DIR` selects a screenshot output directory; optional `STUDIO_REVIEW_LOGO` selects an existing JPEG brand asset. The harness uses installed esbuild, Playwright and axe-core tooling and never requires production credentials.

This branch was reconciled with the merged catalog video uploader in main (`62892bf`). The overlap was confined to the historical test-boundary file; both functional test scopes were preserved. Uploader implementation files, package manifests and migrations have no changes in the Studio diff.
