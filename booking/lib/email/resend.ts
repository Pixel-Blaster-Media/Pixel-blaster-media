import "server-only";

import { getCredential } from "@/lib/integrations/credentials";
import {
  formatFromAddress,
  getOrganizationEmailSettings,
} from "@/lib/email/settings";

/**
 * Thin Resend wrapper.
 *
 * - Uses Resend's HTTP API directly so we don't need to add the SDK
 *   as a dependency just for one POST.
 * - If RESEND_API_KEY isn't set, sendEmail() becomes a no-op that logs a
 *   warning. This lets the booking form work end-to-end locally before you
 *   wire up Resend (you'll just see the request land in Supabase).
 */

interface SendEmailArgs {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html: string;
  /** Plain-text fallback. Auto-derived from html if omitted. */
  text?: string;
  /** Reply-To override; useful so client replies go to your real inbox. */
  replyTo?: string;
  /** Company scope for credentials, sender display name, and reply-to defaults. */
  organizationId?: string | null;
}

export interface SendEmailResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const [apiKey, settings] = await Promise.all([
    getCredential(
      "resend",
      "api_key",
      "RESEND_API_KEY",
      args.organizationId ?? undefined,
    ),
    getOrganizationEmailSettings(args.organizationId),
  ]);
  const baseFrom = process.env.EMAIL_FROM;
  const from = baseFrom
    ? formatFromAddress(baseFrom, settings.fromName)
    : null;
  const replyTo = args.replyTo ?? settings.replyToEmail ?? undefined;

  if (!apiKey || !from) {
    console.warn(
      "[email] Resend API key or EMAIL_FROM not set — skipping send to",
      args.to,
    );
    return { ok: true, skipped: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(args.to) ? args.to : [args.to],
        ...(args.cc
          ? { cc: Array.isArray(args.cc) ? args.cc : [args.cc] }
          : {}),
        ...(args.bcc
          ? { bcc: Array.isArray(args.bcc) ? args.bcc : [args.bcc] }
          : {}),
        subject: args.subject,
        html: args.html,
        text: args.text ?? stripHtml(args.html),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[email] Resend send failed", res.status, body);
      return { ok: false, error: `Resend ${res.status}` };
    }

    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id };
  } catch (err) {
    console.error("[email] Resend send threw", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
