import type { Metadata } from "next";

import { getQBClient, QBOError } from "@/lib/integrations/quickbooks/client";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import ConnectButton from "./ConnectButton";
import DisconnectButton from "./DisconnectButton";
import EmailTester from "./EmailTester";
import GoogleConnectButton from "./GoogleConnectButton";
import GoogleDisconnectButton from "./GoogleDisconnectButton";
import ItemPicker from "./ItemPicker";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

type ConnectionRow =
  Database["public"]["Tables"]["quickbooks_connection"]["Row"];
type GoogleConnectionRow =
  Database["public"]["Tables"]["google_calendar_connection"]["Row"];

interface QBOItem {
  Id: string;
  Name: string;
  Type: string;
  Active?: boolean;
}

interface ItemQueryResponse {
  QueryResponse: { Item?: QBOItem[] };
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: {
    qbo_connected?: string;
    qbo_error?: string;
    google_connected?: string;
    google_error?: string;
  };
}) {
  const supabase = getServerSupabase();
  const { data: connection } = await supabase
    .from("quickbooks_connection")
    .select("*")
    .eq("id", 1)
    .maybeSingle<ConnectionRow>();
  const { data: googleConnection } = await supabase
    .from("google_calendar_connection")
    .select("*")
    .eq("id", 1)
    .maybeSingle<GoogleConnectionRow>();

  let items: QBOItem[] | null = null;
  let itemError: string | null = null;
  if (connection) {
    try {
      const qb = await getQBClient();
      const res = await qb.query<ItemQueryResponse>(
        "SELECT Id, Name, Type, Active FROM Item WHERE Type = 'Service' MAXRESULTS 100",
      );
      items = (res.QueryResponse.Item ?? []).filter((i) => i.Active !== false);
    } catch (err) {
      itemError =
        err instanceof QBOError
          ? `Could not load items (${err.status}): ${err.message}`
          : String(err);
    }
  }

  const flashError = searchParams.qbo_error;
  const flashOk = searchParams.qbo_connected === "1";
  const googleFlashError = searchParams.google_error;
  const googleFlashOk = searchParams.google_connected === "1";

  // Email/Resend configuration status — strictly server-side so we can show
  // whether env vars are set without ever leaking the values.
  const resendConfigured = Boolean(process.env.RESEND_API_KEY);
  const emailFrom = process.env.EMAIL_FROM ?? null;
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL ?? "";
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );

  return (
    <div className="space-y-10">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Settings
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">Integrations</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Third-party services that plug into the booking system.
        </p>
      </header>

      {flashError ? (
        <p
          role="alert"
          className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200"
        >
          QuickBooks connection failed ({flashError}). Double-check your
          Intuit app's redirect URI matches{" "}
          <code>{process.env.NEXT_PUBLIC_APP_URL}/api/integrations/quickbooks/callback</code>
          .
        </p>
      ) : null}
      {flashOk ? (
        <p className="rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">
          QuickBooks connected. Pick a default service item below and you're
          ready to invoice.
        </p>
      ) : null}
      {googleFlashError ? (
        <p
          role="alert"
          className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200"
        >
          Google Calendar connection failed ({googleFlashError}). Double-check
          that your OAuth app&apos;s authorized redirect URI matches{" "}
          <code>{process.env.NEXT_PUBLIC_APP_URL}/api/integrations/google-calendar/callback</code>
          .
        </p>
      ) : null}
      {googleFlashOk ? (
        <p className="rounded-md border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">
          Google Calendar connected. Busy blocks from{" "}
          {googleConnection?.google_account_email ?? "your calendar"} now hide
          booking slots, and new bookings land on your calendar automatically.
        </p>
      ) : null}

      <section className="rounded-lg border border-white/10 bg-ink-soft/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Email (Resend)
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Sends booking confirmations, admin notifications, and the
              &ldquo;shoot confirmed&rdquo; email with the portal magic link.
              Supabase magic-link / signup emails are configured separately
              in Supabase → Auth → Emails → SMTP Settings (use the same
              Resend API key there).
            </p>
          </div>
          {resendConfigured && emailFrom ? (
            <span className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-200">
              Configured
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-200">
              Not configured
            </span>
          )}
        </div>

        <div className="mt-5 space-y-4">
          <dl className="grid gap-y-1 text-sm md:grid-cols-[180px_1fr]">
            <dt className="text-ink-muted">RESEND_API_KEY</dt>
            <dd className="text-white">
              {resendConfigured ? (
                <span className="text-emerald-200">set</span>
              ) : (
                <span className="text-amber-300">not set in Vercel env</span>
              )}
            </dd>
            <dt className="text-ink-muted">EMAIL_FROM</dt>
            <dd className="text-white">
              {emailFrom ? (
                <code className="text-xs">{emailFrom}</code>
              ) : (
                <span className="text-amber-300">not set in Vercel env</span>
              )}
            </dd>
            <dt className="text-ink-muted">ADMIN_NOTIFICATION_EMAIL</dt>
            <dd className="text-white">
              {adminEmail ? (
                <code className="text-xs">{adminEmail}</code>
              ) : (
                <span className="text-ink-muted">—</span>
              )}
            </dd>
          </dl>

          <div>
            <p className="text-xs uppercase tracking-wider text-brand-light">
              Send test email
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Sends a plain test email via the same pipeline that powers
              booking confirmations. The result below shows exactly what
              Resend returned — no guesswork.
            </p>
            <div className="mt-3">
              <EmailTester defaultTo={adminEmail} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-ink-soft/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Google Calendar</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Syncs your personal calendar with the booking system. Busy
              blocks (personal appointments, other commitments) hide their
              time slots from realtors, so nothing can double-book you. When
              a realtor confirms a booking, the shoot is added to your
              calendar automatically with the property address, realtor
              contact info, and any notes.
            </p>
          </div>
          {googleConnection ? (
            <span className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-200">
              Connected
            </span>
          ) : googleConfigured ? (
            <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-200">
              Not connected
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-muted">
              Not configured
            </span>
          )}
        </div>

        {googleConnection ? (
          <div className="mt-5 space-y-4">
            <dl className="grid gap-y-1 text-sm md:grid-cols-[180px_1fr]">
              <dt className="text-ink-muted">Connected account</dt>
              <dd className="text-white">
                <code className="text-xs">
                  {googleConnection.google_account_email}
                </code>
              </dd>
              <dt className="text-ink-muted">Calendar</dt>
              <dd className="text-white">
                <code className="text-xs">{googleConnection.calendar_id}</code>
              </dd>
              <dt className="text-ink-muted">Connected</dt>
              <dd className="text-white">
                {new Date(googleConnection.connected_at).toLocaleString()}
              </dd>
            </dl>
            <GoogleDisconnectButton />
          </div>
        ) : googleConfigured ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-ink-muted">
              Click Connect, approve the access request on Google, and you&apos;ll
              land back here. You can disconnect anytime — revokes access on
              Google&apos;s end too.
            </p>
            <GoogleConnectButton />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-ink-muted">
              First-time setup:
            </p>
            <ol className="list-inside list-decimal space-y-1 text-sm text-ink-muted">
              <li>
                Create an OAuth 2.0 Client ID at{" "}
                <a
                  className="text-brand-light underline"
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener"
                >
                  console.cloud.google.com
                </a>
                .
              </li>
              <li>
                Enable the <strong>Google Calendar API</strong> for the same
                Google Cloud project.
              </li>
              <li>
                Set Authorized redirect URI to{" "}
                <code className="text-xs">
                  {process.env.NEXT_PUBLIC_APP_URL}/api/integrations/google-calendar/callback
                </code>
                .
              </li>
              <li>
                Copy the Client ID + Client Secret into{" "}
                <code>GOOGLE_CLIENT_ID</code> /{" "}
                <code>GOOGLE_CLIENT_SECRET</code> env vars in Vercel, redeploy.
              </li>
              <li>Refresh this page and click Connect.</li>
            </ol>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-white/10 bg-ink-soft/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">QuickBooks Online</h2>
            <p className="mt-1 text-sm text-ink-muted">
              When you click &quot;Send invoice&quot; on a booking, we upsert the
              realtor as a QB customer and create an invoice with line items
              from your pricing settings. Invoices land in QuickBooks exactly
              where your accountant expects them.
            </p>
          </div>
          {connection ? (
            <span className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-200">
              Connected · {connection.environment}
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-muted">
              Not connected
            </span>
          )}
        </div>

        {connection ? (
          <div className="mt-5 space-y-4">
            <dl className="grid gap-y-1 text-sm md:grid-cols-[180px_1fr]">
              <dt className="text-ink-muted">Realm (company) id</dt>
              <dd className="text-white">
                <code className="text-xs">{connection.realm_id}</code>
              </dd>
              <dt className="text-ink-muted">Connected</dt>
              <dd className="text-white">
                {new Date(connection.connected_at).toLocaleString()}
              </dd>
              <dt className="text-ink-muted">Default service item</dt>
              <dd className="text-white">
                {connection.default_item_id ? (
                  items?.find((i) => i.Id === connection.default_item_id)?.Name ??
                  connection.default_item_id
                ) : (
                  <span className="text-amber-300">Not set — pick one below</span>
                )}
              </dd>
            </dl>

            {itemError ? (
              <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
                {itemError}
              </p>
            ) : (
              <ItemPicker
                items={items ?? []}
                currentItemId={connection.default_item_id}
              />
            )}

            <DisconnectButton />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-ink-muted">
              First-time setup:
            </p>
            <ol className="list-inside list-decimal space-y-1 text-sm text-ink-muted">
              <li>
                Create an app at{" "}
                <a
                  className="text-brand-light underline"
                  href="https://developer.intuit.com"
                  target="_blank"
                  rel="noopener"
                >
                  developer.intuit.com
                </a>
                .
              </li>
              <li>
                Set the redirect URI to{" "}
                <code className="text-xs">
                  {process.env.NEXT_PUBLIC_APP_URL}/api/integrations/quickbooks/callback
                </code>
                .
              </li>
              <li>
                Copy the Client ID + Client Secret into <code>QUICKBOOKS_CLIENT_ID</code>{" "}
                / <code>QUICKBOOKS_CLIENT_SECRET</code> env vars.
              </li>
              <li>
                Set <code>QUICKBOOKS_ENVIRONMENT</code> to{" "}
                <code>sandbox</code> for testing or <code>production</code> when you're
                ready.
              </li>
              <li>Click Connect below to grant access.</li>
            </ol>
            <ConnectButton />
          </div>
        )}
      </section>
    </div>
  );
}
