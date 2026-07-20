import "server-only";

import { sendEmail } from "@/lib/email/resend";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getServiceSupabase } from "@/lib/supabase/server";

import {
  createBetaInviteToken,
  hashBetaInviteToken,
  isBetaInviteUsable,
} from "./beta-invite-core";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RAW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const BETA_INVITE_COOKIE = "pb_beta_company_invite";

interface BetaInviteRow {
  id: string;
  email: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  organization_id: string | null;
  status: string;
}

interface IssuedInviteResult {
  id: string;
  created: boolean;
  expires_at: string;
  delivery_status: "pending" | "confirmed" | "unconfirmed";
}

export interface ActiveBetaCompanyInvite {
  id: string;
  email: string;
  expiresAt: string;
  tokenHash: string;
}

export interface BetaInviteActionResult {
  ok: boolean;
  error?: string;
  warning?: string;
  email?: string;
  expiresAt?: string;
  invitationSent?: boolean;
}

export async function issueBetaCompanyInvite(input: {
  email: string;
  actorId: string;
}): Promise<BetaInviteActionResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Enter a valid owner email." };

  const service = getServiceSupabase();
  const { data: authState, error: authLookupError } = await service.rpc(
    "find_beta_auth_user_by_email",
    { p_email: email },
  );
  if (authLookupError) {
    return { ok: false, error: "Account eligibility could not be verified. Try again." };
  }
  if (authState !== null) {
    return {
      ok: false,
      error: "That email already has an account or pending account recovery. Reconcile the existing invitation instead.",
    };
  }

  const appUrl = normalizedAppUrl();
  if (!appUrl) {
    return { ok: false, error: "Beta invitations are not configured." };
  }

  const { rawToken, tokenHash } = createBetaInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const { data: issueData, error: issueError } = await service.rpc(
    "issue_beta_company_invite",
    {
      p_email: email,
      p_token_hash: tokenHash,
      p_invited_by: input.actorId,
      p_expires_at: expiresAt,
    },
  );
  const issued = parseIssuedInvite(issueData);
  if (issueError || !issued) {
    return { ok: false, error: "Could not create the beta invitation." };
  }
  if (!issued.created) {
    return {
      ok: true,
      email,
      expiresAt: issued.expires_at,
      invitationSent: issued.delivery_status === "confirmed",
      warning:
        "An existing invitation remains valid and was not replaced. Revoke it explicitly before issuing a new link.",
    };
  }
  const inviteId = issued.id;

  const actionLink = new URL("/beta/join", appUrl);
  actionLink.searchParams.set("t", rawToken);
  const delivery = await sendEmail({
    to: email,
    subject: "Your private beta invitation",
    html: betaInvitationHtml({ actionLink: actionLink.toString() }),
    organizationId: DEFAULT_ORGANIZATION_ID,
    idempotencyKey: `beta-company-invite:${inviteId}`,
  });
  const deliveryStatus = delivery.ok && !delivery.skipped
    ? "confirmed"
    : "unconfirmed";
  const { data: deliveryMarked, error: deliveryMarkError } = await service.rpc(
    "mark_beta_company_invite_delivery",
    { p_invite_id: inviteId, p_delivery_status: deliveryStatus },
  );

  if (deliveryMarkError || deliveryMarked !== true) {
    return {
      ok: true,
      email,
      expiresAt,
      invitationSent: deliveryStatus === "confirmed",
      warning:
        "Invitation delivery state could not be recorded. Confirm with the recipient before revoking or replacing it.",
    };
  }
  if (deliveryStatus === "unconfirmed") {
    return {
      ok: true,
      email,
      expiresAt,
      invitationSent: false,
      warning:
        "Delivery could not be confirmed. The invitation remains valid in case the email was accepted. Confirm with the recipient before revoking it.",
    };
  }

  return { ok: true, email, expiresAt, invitationSent: true };
}

export async function getActiveBetaCompanyInvite(
  rawToken: string,
): Promise<ActiveBetaCompanyInvite | null> {
  if (!RAW_TOKEN_RE.test(rawToken)) return null;
  const tokenHash = hashBetaInviteToken(rawToken);
  const service = getServiceSupabase();
  const { data, error } = await service
    .from("beta_company_invites")
    .select("id, email, expires_at, consumed_at, revoked_at, organization_id, status")
    .eq("token_hash", tokenHash)
    .maybeSingle<BetaInviteRow>();
  if (error || !data) return null;
  if (
    !["issued", "provisioning"].includes(data.status) ||
    !isBetaInviteUsable({
      expiresAt: data.expires_at,
      consumedAt: data.consumed_at,
      revokedAt: data.revoked_at,
    })
  ) {
    return null;
  }
  return { id: data.id, email: data.email, expiresAt: data.expires_at, tokenHash };
}

export async function revokeBetaCompanyInvite(input: {
  inviteId: string;
  actorId: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.inviteId)) {
    return { ok: false, error: "Invalid invitation." };
  }
  const service = getServiceSupabase();
  const { data, error } = await service.rpc("revoke_beta_company_invite", {
    p_invite_id: input.inviteId,
    p_actor_id: input.actorId,
  });
  if (error || data !== true) {
    return { ok: false, error: "The invitation is no longer revocable." };
  }
  return { ok: true };
}

function parseIssuedInvite(value: unknown): IssuedInviteResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.created !== "boolean" ||
    typeof row.expires_at !== "string" ||
    !["pending", "confirmed", "unconfirmed"].includes(String(row.delivery_status))
  ) {
    return null;
  }
  return row as unknown as IssuedInviteResult;
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizedAppUrl(): URL | null {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function betaInvitationHtml(input: { actionLink: string }): string {
  const link = escapeHtml(input.actionLink);
  return `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#1f3028;max-width:560px;margin:auto">
      <p style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#3f7f5f">Private beta</p>
      <h1 style="font-size:28px;line-height:1.2">Build your booking workspace</h1>
      <p>You have been invited to create a separate company workspace for your own services, availability, customers, and integrations.</p>
      <p><a href="${link}" style="display:inline-block;background:#3f7f5f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700">Set up my company</a></p>
      <p style="font-size:13px;color:#63736b">This email-bound link expires in seven days and can create one company.</p>
    </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
