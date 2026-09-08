# Post-booking authentication: local verification

## Narrow change

Successful public booking returns a committed receipt instead of asking Next to inline the portal redirect. The receipt is phone-first cream/forest green, follows the confirmation email's header/When/Where/services structure, shows request-local committed booking details, replaces the entire review shell and submission form, and offers an ordinary document link. It remains visible until the customer chooses to continue. No new receipt details are put into URLs or persistent browser storage. The existing session-installation-failure success destination and query contract are retained.

Password sign-in returns its existing sanitized destination only after verified cookie installation. The client performs `window.location.replace`, with a normal link fallback. Middleware, HMAC attestation, auth verification, transaction/idempotency, and provider dispatch semantics are unchanged.

## Mechanism proven with the locked framework

Next 16.3's `createRedirectRenderResult` internally fetches an action's redirect destination with forwarded headers. A POST/path attestation cannot verify for that GET/new path. The existing containment policy redirects the internal hostname to the public hostname. Fetch strips Cookie on that hostname change. The resulting anonymous sign-in RSC can be streamed as the portal's action redirect result even while the browser successfully installs the original action's session cookie.

The baseline browser fixture naturally reached `/portal/<fixture>?booked=1` showing the real sign-in form, with a secure session cookie present. Submitting that form produced the global fallback. It did not force browser history or inject a copied action ID. The installed framework handles the action IDs and redirect/worker forwarding.

`AuthSessionHandler` only handles implicit fragment tokens, not the password booking path. The manual cookie installer succeeded in the baseline. The `observedCookies` snapshot is not required for this reproduction (the fixture replaces the backend client); this does not prove that every separate cookie concurrency issue is absent. No speculative cookie-adapter change is included.

## Reproduce safely

From `booking/`, run `npm ci --ignore-scripts`. Install Playwright outside the project to avoid changing its dependency lock:

```sh
npm install --prefix /tmp/pixel-playwright playwright --no-audit --no-fund
node scripts/verify-post-booking-browser.mjs
PIXEL_TEST_COOKIE_FAILURE=1 node scripts/verify-post-booking-browser.mjs
```

Prerequisites: Node compatible with the lock, OpenSSL, and a Chromium executable. Defaults use `/tmp/pixel-playwright/node_modules/playwright/index.mjs` and macOS Chrome. Set `PLAYWRIGHT_MODULE` to an absolute module path and `CHROME_EXECUTABLE` to another Chromium binary on other machines. No browser credentials or production environment files are needed or loaded.

The script generates a private temporary fixture, copies the real application actions/forms/continuation route/middleware/security code/CSS, and uses the locked installed Next package. The confirmation route copies the actual `page.tsx`, Stepper, brand header, upsell panel, and ConfirmForm unchanged; it supplies a synthetic catalog with an available upsell and real wizard query parameters. Other destinations use minimal page shells. It substitutes explicit account/inbox/DB/provider dependencies. The password-grant transport is synthetic; the actual verified-user/claims/cookie-installation code remains, with the Auth response supplied by the fixture. The failure mode injects an installer exception only in the generated fixture. This is not proof of hosted Supabase or PostgreSQL behavior.

A HTTPS proxy on `127.0.0.1` signs requests to the local Next server on `localhost`, making the internal hostname transition observable without production traffic. Local-only adaptations strip the ephemeral Origin port for Next's host comparison and correct HTTPS `Location` headers targeting the HTTP-only localhost Next port to HTTP. The latter preserves the subsequent real canonical-containment middleware hop. TLS verification is disabled only in this synthetic child process to accept its generated self-signed loopback certificate. None of these fixture adaptations is shipped in the application.

Generated fixture builds intentionally skip typechecking for the untyped synthetic stubs. Always run the **separate real full-app build and typecheck** below.

## Assertions

- Inbox challenge, then exactly one synthetic identity provisioning and one synthetic atomic booking call; only two booking action POSTs (challenge + commit).
- Before submission, the actual parent page renders Review + confirm, booking summary, and an available upsell. After commitment, all review headings/instructions, upsell, wizard navigation, and submission form are removed from the DOM; the in-progress brand header is also removed and focus moves to the receipt heading.
- Actual address, Eastern date/time, package/add-on summary and organization are returned through action state.
- No horizontal overflow at 390px or 320px; at least 44px link target; screenshot artifacts at both widths.
- Verified cookie names/flags only: Secure, SameSite=Lax, Path=/, existing SDK-compatible HttpOnly=false.
- Receipt link reaches signed-in portal; reload remains signed in.
- Clearing cookies triggers the natural document sign-in bounce; password login returns through the real continuation route to the portal.
- No `x-action-redirect` on successful action responses, no browser page errors, no automatic booking retries.
- Unsigned direct-alias action with forged `next-action`/`x-action-forwarded` stays 421.
- Installer-failure variant still shows receipt and opens the existing confirmation fallback with one booking/provision call and no session cookie.

The counters prove application call behavior in the fixture, not production row counts. Existing database idempotency protection is unchanged; no real database or provider writes are performed by this probe.

## Full-shell review-blocker regression

`ConfirmForm` owns a server-rendered `children` slot containing the existing brand header, Stepper, selection notice, review heading/instructions, summary, and upsell. Its pre-success branch renders that slot plus the form; its committed-success branch renders only the receipt. The brand header remains unchanged before success; after success the receipt supplies company branding without the contradictory “Booking in progress” label. No CSS hiding, global DOM manipulation, auth/security/schema changes, or new persistence are involved.

The compiled full-parent browser regression failed before the source fix (`full-shell-red.log`: Review + confirm remained in the DOM), then passed in normal and installer-failure modes (`full-shell-green.log`, `full-shell-failure-green.log`). Full-app gates passed: 588 tests, lint, typecheck, production build, and diff whitespace check. Existing middleware deprecation and synthetic unavailable-auth build diagnostics remain.

Full-page mobile evidence is `full-shell-green-{320,390}.png` with failure-mode counterparts in the audit directory. Both widths show only the cream/green receipt, with no stale review/upsell, in-progress brand header, or receipt clipping. `full-shell-header-red.log` preserves the additional RED for the contradictory in-progress label before moving the existing header into the review slot. Browser fixtures remain synthetic, not hosted provider/database verification.

## Full-app gates

```sh
npm test
npm run lint
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon \
SUPABASE_SERVICE_ROLE_KEY=fixture-service \
NEXT_PUBLIC_APP_URL=https://ci.example.invalid npm run build
npm run typecheck
git diff --check
```

Local evidence is recorded at `/Users/PlatoTheBot/.hermes/audits/pixel-post-booking-auth-0908/`. Baseline browser RED and action-contract RED logs are retained separately from GREEN. Full application build succeeds with the existing Next middleware deprecation warning and expected unavailable-auth diagnostics for synthetic build credentials.

No push or deployment is part of this implementation. Hosted auth/provider/real-row canaries and independent release review remain separate gates.
