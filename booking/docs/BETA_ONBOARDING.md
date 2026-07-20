# Invite-only beta company onboarding

The private-beta path lets a platform owner invite a small number of business owners without opening unrestricted public company registration.

## Operator flow

1. Sign in as the configured platform owner.
2. Open **Settings → Companies**.
3. Enter the new owner's email under **Invite-only beta**.
4. The owner receives a seven-day, email-bound link.
5. The owner chooses their company name, booking handle, colours, and whether to copy the starter catalogue.
6. The platform creates a separate hidden tenant and sends stable owner sign-in instructions.
7. The owner requests a fresh one-time email link from that protected sign-in page, then configures their own availability and integrations.
8. Review the company and choose **Activate booking link** when it is ready for customers.

Pending invitations can be revoked from the same Companies page. Repeating an issue action preserves the existing possibly delivered link; revoke it explicitly before issuing a replacement. Once provisioning starts, the original company details become immutable and the invitation is no longer revocable through the normal UI.

## Security boundaries

- Public Auth signup remains disabled.
- A valid 256-bit bearer token is required to reach company setup.
- Only the SHA-256 token hash is stored; the raw token exists only in the invitation link and a short-lived `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
- The token-bearing route immediately redirects to a clean URL with a no-referrer/no-store response.
- Invitations are bound to one normalized email, expire after seven days, and are consumed by one organization.
- Provisioning inputs are persisted on first use; identical retries resume the same organization and changed-input retries fail closed.
- New organizations start in `onboarding` and cannot resolve through any public booking page or booking action until the platform owner activates them.
- Company ownership is finalized only when that email is the new organization's owner.
- The recipient cannot choose an arbitrary owner email or existing organization.
- New tenants receive separate customers, bookings, branding, availability, and integration records.
- Copying the starter catalogue copies non-secret catalogue configuration only. Provider credentials, OAuth tokens, customer data, booking history, and integration mappings are never copied.
- Platform invite issuance and revocation remain behind the explicit platform-admin allowlist.

## Failure and retry behavior

- Invitation issuance is serialized per email. An ambiguous retry preserves the existing link; replacement requires an explicit successful revocation first.
- If invitation email delivery is uncertain, the invite is preserved and shown to the operator for revocation/replacement; the raw link is not logged or exposed in action state.
- Company provisioning is row-locked and first-write-wins. Retrying the same immutable details resumes the same reserved organization; different details cannot overwrite it.
- Invitation issuance and Auth identity insertion share the same database advisory lock. An issued email is reserved, and provisioning Auth creation requires the invitation's private one-time provisioning capability.
- Auth creation reuses the existing protected-marker recovery path, so an accepted-but-response-lost mutation does not create a second identity. The provisioning capability is removed after ownership is finalized.
- Owner instructions contain a stable sign-in-page URL rather than a pre-generated Auth token. Retries therefore cannot invalidate a previously delivered magic link; the owner requests a fresh one-time link when ready to sign in.
- Provisioning that exceeds its bounded attempt window becomes reconciliation-visible. Active provisioning cannot be reconciled early; after expiry the platform owner can safely reopen the same invitation, Auth identity, and hidden organization for an idempotent retry.
- Invitation completion is row-locked and idempotent for the same user and organization. It rejects revocation, identity/owner mismatch, and attempts to switch a completed invite.

## Production rollout

This feature is migration-first:

1. Run all Node, PostgreSQL, typecheck, lint, build, and setup-determinism gates.
2. Probe `20260720120000_beta_company_invitations.sql` against linked production inside a rollback-only transaction.
3. Apply and verify only that exact migration.
4. Configure `BETA_COMPANY_ONBOARDING_ENABLED=false` and deploy the compatible application build.
5. Verify `/api/health`, `/beta/join`, `/beta/onboarding`, the hidden-company booking denial, and the platform Companies page.
6. Set `BETA_COMPANY_ONBOARDING_ENABLED=true`, redeploy, and confirm the platform-only invitation form appears.
7. Issue the first real beta invitation only after those checks pass.

Do not use broad migration-history repair or `--include-all` operations for this rollout.
