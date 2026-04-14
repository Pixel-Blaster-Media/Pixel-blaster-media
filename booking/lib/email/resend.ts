import "server-only";

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
  subject: string;
  html: string;
  /** Plain-text fallback. Auto-derived from html if omitted. */
  text?: string;
  /** Reply-To override; useful so client replies go to your real inbox. */
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn(
      "[email] RESEND_API_KEY or EMAIL_FROM not set — skipping send to",
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
        subject: args.subject,
        html: args.html,
        text: args.text ?? stripHtml(args.html),
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
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
