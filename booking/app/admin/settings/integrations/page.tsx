import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  getGoogleCalendarConnection,
  getGoogleCalendarSources,
} from "@/lib/integrations/google-calendar/client";
import { getCredentialSource } from "@/lib/integrations/credentials";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organizations/default";
import { getQBClient, QBOError } from "@/lib/integrations/quickbooks/client";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import ConnectButton from "./ConnectButton";
import CopyTextButton from "./CopyTextButton";
import CredentialsForm, {
  type CredentialFieldStatus,
} from "./CredentialsForm";
import DisconnectButton from "./DisconnectButton";
import EmailTester from "./EmailTester";
import GoogleConnectButton from "./GoogleConnectButton";
import GoogleDisconnectButton from "./GoogleDisconnectButton";
import GoogleCalendarTester from "./GoogleCalendarTester";
import IGuideTester from "./IGuideTester";
import ItemPicker from "./ItemPicker";
import OpenAITester from "./OpenAITester";
import {
  addExternalGoogleCalendarSource,
  deleteGoogleCalendarSource,
  updateGoogleCalendarSource,
} from "./actions";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

type ConnectionRow =
  Database["public"]["Tables"]["quickbooks_connection"]["Row"];

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
  searchParams: Promise<{
    qbo_connected?: string;
    qbo_error?: string;
    google_connected?: string;
    google_error?: string;
  }>;
}) {
  const admin = await requireAdmin();
  const isDefaultOrganization = admin.organizationId === DEFAULT_ORGANIZATION_ID;
  const params = await searchParams;
  const supabase = await getServerSupabase();
  const { data: connection } = await supabase
    .from("quickbooks_connection")
    .select("*")
    .eq("organization_id", admin.organizationId)
    .maybeSingle<ConnectionRow>();
  const googleConnection = await getGoogleCalendarConnection({
    organizationId: admin.organizationId,
  });
  const googleSources = await getGoogleCalendarSources({
    organizationId: admin.organizationId,
  });

  let items: QBOItem[] | null = null;
  let itemError: string | null = null;
  if (connection) {
    try {
      const qb = await getQBClient({ organizationId: admin.organizationId });
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

  const flashError = params.qbo_error;
  const flashOk = params.qbo_connected === "1";
  const googleFlashError = params.google_error;
  const googleFlashOk = params.google_connected === "1";

  // Per-provider credential status — strictly server-side so we can
  // show whether each field is set without ever leaking values.
  const [
    resendApiKeyStatus,
    autoenhanceApiKeyStatus,
    autoenhanceWebhookStatus,
    openAiApiKeyStatus,
    openAiModelStatus,
    googleMapsApiKeyStatus,
    iguideAppIdStatus,
    iguideAppTokenStatus,
    iguideWebhookStatus,
  ]: CredentialFieldStatus[] = await Promise.all([
    isDefaultOrganization
      ? getCredentialSource(
          "resend",
          "api_key",
          "RESEND_API_KEY",
          admin.organizationId,
        )
      : Promise.resolve({ source: "none" as const }),
    getCredentialSource(
      "autoenhance",
      "api_key",
      "AUTOENHANCE_API_KEY",
      admin.organizationId,
    ),
    getCredentialSource(
      "autoenhance",
      "webhook_secret",
      "AUTOENHANCE_WEBHOOK_SECRET",
      admin.organizationId,
    ),
    getCredentialSource(
      "openai",
      "api_key",
      "OPENAI_API_KEY",
      admin.organizationId,
    ),
    getCredentialSource(
      "openai",
      "model",
      "OPENAI_ASSISTANT_MODEL",
      admin.organizationId,
    ),
    getCredentialSource(
      "google_maps",
      "api_key",
      "GOOGLE_MAPS_SERVER_API_KEY",
      admin.organizationId,
    ),
    getCredentialSource("iguide", "app_id", "IGUIDE_APP_ID", admin.organizationId),
    getCredentialSource(
      "iguide",
      "app_token",
      "IGUIDE_APP_TOKEN",
      admin.organizationId,
    ),
    getCredentialSource(
      "iguide",
      "webhook_secret",
      "IGUIDE_WEBHOOK_SECRET",
      admin.organizationId,
    ),
  ]);

  const resendConfigured = resendApiKeyStatus.source !== "none";
  const autoenhanceConfigured = autoenhanceApiKeyStatus.source !== "none";
  const openAiConfigured = openAiApiKeyStatus.source !== "none";
  const googleMapsConfigured = googleMapsApiKeyStatus.source !== "none";
  const iguideConfigured =
    iguideAppIdStatus.source !== "none" &&
    iguideAppTokenStatus.source !== "none";
  const iguideWebhookConfigured = iguideWebhookStatus.source !== "none";

  const emailFrom = isDefaultOrganization ? process.env.EMAIL_FROM ?? null : null;
  const adminEmail = isDefaultOrganization
    ? process.env.ADMIN_NOTIFICATION_EMAIL ?? ""
    : "";
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  const googleReady = Boolean(googleConnection && googleConfigured);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const iguideWebhookUrlBase = appUrl
    ? `${appUrl}/api/integrations/iguide/webhook?secret=`
    : "/api/integrations/iguide/webhook?secret=";
  const autoenhanceWebhookUrl = `${appUrl || ""}/api/integrations/autoenhance/webhook?org=${admin.organizationId}`;

  return (
    <div className="space-y-10">
      <header className="realtor-panel rounded-2xl p-4">
        <Link
          href="/admin/settings"
          className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary hover:text-realtor-text"
        >
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-realtor-text">
          Integrations
        </h1>
        <p className="mt-2 text-sm text-realtor-muted">
          Third-party services that plug into the booking system.
        </p>
      </header>

      {flashError ? (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          QuickBooks connection failed ({flashError}). Double-check your
          Intuit app's redirect URI matches{" "}
          <code>{process.env.NEXT_PUBLIC_APP_URL}/api/integrations/quickbooks/callback</code>
          .
        </p>
      ) : null}
      {flashOk ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          QuickBooks connected. Pick a default service item below and you're
          ready to invoice.
        </p>
      ) : null}
      {googleFlashError ? (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          Google Calendar connection failed ({googleFlashError}). Double-check
          that your OAuth app&apos;s authorized redirect URI matches{" "}
          <code>{process.env.NEXT_PUBLIC_APP_URL}/api/integrations/google-calendar/callback</code>
          .
        </p>
      ) : null}
      {googleFlashOk ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Google Calendar connected. Busy blocks from{" "}
          {googleConnection?.google_account_email ?? "your calendar"} now hide
          booking slots, and new bookings land on your calendar automatically.
        </p>
      ) : null}

      {isDefaultOrganization ? (
      <section className="realtor-elevated-panel rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-realtor-text">
              Email (Resend)
            </h2>
            <p className="mt-1 text-sm text-realtor-muted">
              Sends booking confirmations, admin notifications, and the
              &ldquo;shoot confirmed&rdquo; email with the portal magic link.
              Supabase magic-link / signup emails are configured separately
              in Supabase → Auth → Emails → SMTP Settings (use the same
              Resend API key there).
            </p>
          </div>
          {resendConfigured && emailFrom ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              Configured
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              Not configured
            </span>
          )}
        </div>

        <CredentialsForm
          provider="resend"
          fields={[
            {
              name: "api_key",
              label: "Resend API key",
              helper:
                "Starts with re_. Create at resend.com/api-keys with Sending access on pixelblastermedia.com.",
            },
          ]}
          statuses={{ api_key: resendApiKeyStatus }}
        />

        <div className="mt-5 space-y-4 border-t border-realtor-primary/10 pt-4">
          <dl className="grid gap-y-1 text-sm md:grid-cols-[180px_1fr]">
            <dt className="text-realtor-muted">EMAIL_FROM</dt>
            <dd className="text-realtor-text">
              {emailFrom ? (
                <code className="text-xs">{emailFrom}</code>
              ) : (
                <span className="text-amber-700">not set in Vercel env</span>
              )}
            </dd>
            <dt className="text-realtor-muted">ADMIN_NOTIFICATION_EMAIL</dt>
            <dd className="text-realtor-text">
              {adminEmail ? (
                <code className="text-xs">{adminEmail}</code>
              ) : (
                <span className="text-realtor-muted">—</span>
              )}
            </dd>
          </dl>

          <div>
            <p className="text-xs uppercase tracking-wider text-realtor-primary">
              Send test email
            </p>
            <p className="mt-1 text-xs text-realtor-muted">
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
      ) : (
        <section className="realtor-elevated-panel rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-realtor-text">
                Email delivery
              </h2>
              <p className="mt-1 text-sm leading-6 text-realtor-muted">
                Email sending is handled by the platform for beta companies, so
                new businesses do not need their own Resend account or API key.
                Set the sender name, reply-to email, and admin alert inbox in
                Business profile.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              Platform managed
            </span>
          </div>

          <Link
            href="/admin/settings/business"
            className="mt-4 inline-flex rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
          >
            Edit email identity
          </Link>
        </section>
      )}

      <section className="realtor-elevated-panel rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-realtor-text">
              Autoenhance.ai
            </h2>
            <p className="mt-1 text-sm text-realtor-muted">
              Enhance booking photos and send completed full-resolution JPEGs
              into the linked iGUIDE gallery.
            </p>
          </div>
          {autoenhanceConfigured ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              Configured
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              Not configured
            </span>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-realtor-primary/15 bg-realtor-primary/5 p-4">
          <p className="text-sm font-semibold text-realtor-text">
            Automatic completion updates
          </p>
          <p className="mt-1 text-xs leading-relaxed text-realtor-muted">
            Add this URL as the webhook URL in Autoenhance&apos;s API settings.
            Paste the same long random value into Autoenhance&apos;s authentication
            field and the Webhook secret field below. The secret and API key
            remain server-side.
          </p>
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-realtor-primary/15 bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="min-w-0 break-all text-[11px] text-realtor-text">
              {autoenhanceWebhookUrl}
            </code>
            <CopyTextButton value={autoenhanceWebhookUrl} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                autoenhanceWebhookStatus.source === "none"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {autoenhanceWebhookStatus.source === "none"
                ? "Webhook secret needed"
                : "Webhook authentication saved"}
            </span>
            <Link
              href="/admin/autoenhance-test"
              className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
            >
              Open test sandbox
            </Link>
          </div>
        </div>

        <CredentialsForm
          provider="autoenhance"
          fields={[
            {
              name: "api_key",
              label: "Autoenhance API key",
              helper:
                "Create this in Autoenhance. For Vercel env fallback use AUTOENHANCE_API_KEY.",
            },
            {
              name: "webhook_secret",
              label: "Webhook secret",
              helper:
                "Use the exact same random secret in Autoenhance's webhook authentication field. For Vercel fallback use AUTOENHANCE_WEBHOOK_SECRET.",
            },
          ]}
          statuses={{
            api_key: autoenhanceApiKeyStatus,
            webhook_secret: autoenhanceWebhookStatus,
          }}
        />
      </section>

      <section className="realtor-elevated-panel rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-realtor-text">
              AI Assistant
            </h2>
            <p className="mt-1 text-sm text-realtor-muted">
              Powers the floating admin assistant and realtor-facing copy tools.
              You can use the platform key or save this company&apos;s own
              OpenAI API key. Saved keys are never shown again.
            </p>
          </div>
          {openAiConfigured ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              Configured
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              Not configured
            </span>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-realtor-primary/15 bg-realtor-primary/5 p-4">
          <p className="text-sm font-semibold text-realtor-text">
            How this works
          </p>
          <p className="mt-1 text-xs leading-relaxed text-realtor-muted">
            If a company saves its own key, its assistant calls OpenAI with
            that key. If not, the app falls back to the platform
            <code className="mx-1">OPENAI_API_KEY</code>. Anything that changes
            bookings still asks for confirmation first.
          </p>
        </div>

        <CredentialsForm
          provider="openai"
          fields={[
            {
              name: "api_key",
              label: "OpenAI API key",
              helper:
                "Starts with sk-. Create it in the OpenAI dashboard. We store it server-side only.",
            },
            {
              name: "model",
              label: "Model override",
              helper:
                "Optional. Leave blank to use the platform default model.",
              type: "text",
            },
          ]}
          statuses={{
            api_key: openAiApiKeyStatus,
            model: openAiModelStatus,
          }}
        />
        <OpenAITester />
      </section>

      <section className="realtor-elevated-panel rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-realtor-text">
              Google Maps Routes
            </h2>
            <p className="mt-1 text-sm text-realtor-muted">
              Optional. If this is configured, the Today page uses Google
              Routes for drive-time and distance warnings. If it is not
              configured, the app still falls back to simple schedule and city
              checks.
            </p>
          </div>
          {googleMapsConfigured ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              V2 enabled
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-realtor-primary/15 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
              V1 fallback
            </span>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-realtor-primary/15 bg-realtor-primary/5 p-4">
          <p className="text-sm font-semibold text-realtor-text">
            Cost-safe fallback
          </p>
          <p className="mt-1 text-xs leading-relaxed text-realtor-muted">
            Use a server-side Google Maps key with the Routes API enabled.
            Keep your browser Places key separate. The app only calls this
            from server code and only requests route duration and distance.
          </p>
        </div>

        <CredentialsForm
          provider="google_maps"
          fields={[
            {
              name: "api_key",
              label: "Google Maps server API key",
              helper:
                "Enable Routes API. For Vercel env fallback use GOOGLE_MAPS_SERVER_API_KEY.",
            },
          ]}
          statuses={{ api_key: googleMapsApiKeyStatus }}
        />
      </section>

      {/* iGUIDE — Portal API + webhook secret. Used by /admin/bookings to
          sync tour deliverables and by the webhook receiver to verify
          incoming events. */}
      <section className="realtor-elevated-panel rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-realtor-text">iGUIDE</h2>
            <p className="mt-1 text-sm text-realtor-muted">
              Connect this once so new iGUIDEs from your phone can be matched
              to bookings and synced into deliverables. The current API can also
              search the company&apos;s portal tours when the token includes the
              iguide.list permission.
            </p>
          </div>
          {iguideConfigured && iguideWebhookConfigured ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              Ready
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              Setup needed
            </span>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-realtor-primary/15 bg-realtor-primary/5 p-4">
          <p className="text-sm font-semibold text-realtor-text">
            Portal search is now supported
          </p>
          <p className="mt-1 text-xs leading-relaxed text-realtor-muted">
            iGUIDE added the list endpoint to its public documentation in July
            2026. Include <strong>iguide.list</strong>, then use the test button
            below to confirm this token can see portal tours. Manual paste and
            ready webhooks remain available either way.
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-realtor-primary/15 bg-realtor-primary/5 p-4">
          <p className="text-sm font-semibold text-realtor-text">
            What to copy from iGUIDE
          </p>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-realtor-muted">
            <li>
              In iGUIDE, go to{" "}
              <strong>Settings → API Management → API Tokens</strong>.
            </li>
            <li>
              Copy iGUIDE&apos;s <strong>Client ID</strong> into{" "}
              <strong>iGUIDE Client ID</strong> below.
            </li>
            <li>
              Copy iGUIDE&apos;s <strong>Token</strong> into{" "}
              <strong>iGUIDE Token</strong> below.
            </li>
            <li>
              Give that token these permissions: <strong>iguide.read</strong>,{" "}
              <strong>iguide.write</strong>, <strong>iguide.process</strong>, and{" "}
              <strong>iguide.events</strong>. Add <strong>iguide.list</strong> for
              portal tour search.
            </li>
            <li>
              Make up a long random <strong>Webhook secret</strong>, save it
              below, then add it to the end of the webhook URL in iGUIDE.
            </li>
          </ol>
        </div>

        <div className="mt-4 rounded-2xl border border-realtor-primary/15 bg-white/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
            Webhook URL for iGUIDE
          </p>
          <p className="mt-1 text-xs text-realtor-muted">
            After saving the webhook secret below, paste this into iGUIDE&apos;s
            webhook setup and put your secret after the equals sign.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-realtor-primary/15 bg-white px-3 py-2 text-xs text-realtor-text">
              {iguideWebhookUrlBase}YOUR_SECRET_HERE
            </code>
            <CopyTextButton value={`${iguideWebhookUrlBase}YOUR_SECRET_HERE`} />
          </div>
        </div>

        <CredentialsForm
          provider="iguide"
          fields={[
            {
              name: "app_id",
              label: "iGUIDE Client ID",
              helper:
                "In iGUIDE this may be labelled Client ID. It is the short ID beside the token.",
              type: "text",
            },
            {
              name: "app_token",
              label: "iGUIDE Token",
              helper:
                "In iGUIDE this is labelled Token. It is the long secret value shown when the token is created.",
            },
            {
              name: "webhook_secret",
              label: "Webhook secret",
              helper:
                "You choose this. Use a long random value and put the same value after secret= in iGUIDE. If you paste the whole webhook URL here by mistake, we will save just the secret.",
            },
          ]}
          statuses={{
            app_id: iguideAppIdStatus,
            app_token: iguideAppTokenStatus,
            webhook_secret: iguideWebhookStatus,
          }}
        />
        <IGuideTester disabled={!iguideConfigured} />
        {!iguideWebhookConfigured ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            The API credentials can be tested, but automatic ready-event syncing
            stays off until a webhook secret is saved and the matching URL is
            added in iGUIDE.
          </p>
        ) : null}
      </section>

      <section className="realtor-elevated-panel rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-realtor-text">
              Google Calendar
            </h2>
            <p className="mt-1 text-sm text-realtor-muted">
              Syncs your personal calendar with the booking system. Busy
              blocks (personal appointments, other commitments) hide their
              time slots from realtors, so nothing can double-book you. When
              a realtor confirms a booking, the shoot is added to your
              calendar automatically with the property address, realtor
              contact info, and any notes.
            </p>
          </div>
          {googleReady ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              Connected
            </span>
          ) : googleConnection ? (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              Needs env vars
            </span>
          ) : googleConfigured ? (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              Not connected
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-realtor-primary/15 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
              Not configured
            </span>
          )}
        </div>

        {googleConnection ? (
          <div className="mt-5 space-y-4">
            {!googleConfigured ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">
                  Google Calendar is connected, but it cannot sync bookings yet.
                </p>
                <p className="mt-1">
                  <code>GOOGLE_CLIENT_ID</code> and{" "}
                  <code>GOOGLE_CLIENT_SECRET</code> are blank in the app
                  environment. Add those values in Vercel, redeploy, then use
                  the test below.
                </p>
              </div>
            ) : null}
            <dl className="grid gap-y-1 text-sm md:grid-cols-[180px_1fr]">
              <dt className="text-realtor-muted">Connected account</dt>
              <dd className="text-realtor-text">
                <code className="text-xs">
                  {googleConnection.google_account_email}
                </code>
              </dd>
              <dt className="text-realtor-muted">Calendar</dt>
              <dd className="text-realtor-text">
                <code className="text-xs">{googleConnection.calendar_id}</code>
              </dd>
              <dt className="text-realtor-muted">Connected</dt>
              <dd className="text-realtor-text">
                {new Date(googleConnection.connected_at).toLocaleString()}
              </dd>
            </dl>
            <GoogleCalendarTester />
            <GoogleDisconnectButton />

            <div className="rounded-2xl border border-realtor-primary/15 bg-white/70 p-4">
              <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-realtor-text">
                    Calendar sources
                  </p>
                  <p className="mt-1 text-xs leading-5 text-realtor-muted">
                    Keep your main calendar as the booking write target. Add
                    shared subcontractor or personal calendars here when you
                    want them to show on the admin calendar or block public
                    booking slots.
                  </p>
                </div>
                <Link
                  href="/admin/calendar"
                  className="shrink-0 rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
                >
                  Open calendar
                </Link>
              </div>

              <div className="mt-4 space-y-3">
                {googleSources.map((source) =>
                  source.writeBookings ? (
                    <div
                      key={source.id}
                      className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-emerald-950">
                            {source.displayName}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-emerald-800">
                            {source.calendarId} · {source.googleAccountEmail}
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                          booking write target
                        </span>
                      </div>
                    </div>
                  ) : (
                    <form
                      key={source.id}
                      action={updateGoogleCalendarSource}
                      className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/70 p-3"
                    >
                      <input type="hidden" name="source_id" value={source.id} />
                      <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
                        <label className="block">
                          <span className="text-xs text-realtor-muted">
                            Label
                          </span>
                          <input
                            name="display_name"
                            defaultValue={source.displayName}
                            className="admin-input mt-1"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-realtor-muted">
                            Google calendar ID
                          </span>
                          <input
                            name="calendar_id"
                            defaultValue={source.calendarId}
                            className="admin-input mt-1 font-mono text-xs"
                          />
                        </label>
                        <button
                          type="submit"
                          className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90"
                        >
                          Save
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-realtor-muted">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="show_on_admin_calendar"
                            defaultChecked={source.showOnAdminCalendar}
                            className="h-4 w-4 rounded border-realtor-primary/25 text-realtor-primary"
                          />
                          Show on admin calendar
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="block_availability"
                            defaultChecked={source.blockAvailability}
                            className="h-4 w-4 rounded border-realtor-primary/25 text-realtor-primary"
                          />
                          Block online booking
                        </label>
                      </div>
                    </form>
                  ),
                )}
              </div>

              <form
                action={addExternalGoogleCalendarSource}
                className="mt-4 rounded-2xl border border-dashed border-realtor-primary/25 bg-realtor-primary/5 p-3"
              >
                <p className="text-sm font-semibold text-realtor-text">
                  Add external calendar
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
                  <label className="block">
                    <span className="text-xs text-realtor-muted">Label</span>
                    <input
                      name="display_name"
                      placeholder="Subcontractor shoots"
                      className="admin-input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-realtor-muted">
                      Google calendar ID
                    </span>
                    <input
                      name="calendar_id"
                      required
                      placeholder="example@gmail.com or calendar ID"
                      className="admin-input mt-1 font-mono text-xs"
                    />
                  </label>
                  <button
                    type="submit"
                    className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-realtor-muted">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="show_on_admin_calendar"
                      defaultChecked
                      className="h-4 w-4 rounded border-realtor-primary/25 text-realtor-primary"
                    />
                    Show on admin calendar
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="block_availability"
                      defaultChecked
                      className="h-4 w-4 rounded border-realtor-primary/25 text-realtor-primary"
                    />
                    Block online booking
                  </label>
                </div>
              </form>

              {googleSources.some((source) => !source.writeBookings) ? (
                <div className="mt-3 space-y-2">
                  {googleSources
                    .filter((source) => !source.writeBookings)
                    .map((source) => (
                      <form
                        key={`delete-${source.id}`}
                        action={deleteGoogleCalendarSource}
                      >
                        <input
                          type="hidden"
                          name="source_id"
                          value={source.id}
                        />
                        <button
                          type="submit"
                          className="text-xs font-semibold text-red-700 underline-offset-4 hover:underline"
                        >
                          Remove {source.displayName}
                        </button>
                      </form>
                    ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : googleConfigured ? (
          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Seeing &quot;Access blocked&quot;?</p>
              <p className="mt-1 text-xs leading-5">
                The Google OAuth app is probably still in testing mode. Add
                this photographer&apos;s Google account as a test user in Google
                Cloud&apos;s OAuth consent screen, or publish and verify the app
                before inviting outside companies.
              </p>
            </div>
            <p className="text-sm text-realtor-muted">
              Click Connect, approve the access request on Google, and you&apos;ll
              land back here. You can disconnect anytime — revokes access on
              Google&apos;s end too.
            </p>
            <GoogleConnectButton />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-realtor-muted">
              First-time setup:
            </p>
            <ol className="list-inside list-decimal space-y-1 text-sm text-realtor-muted">
              <li>
                Create an OAuth 2.0 Client ID at{" "}
                <a
                  className="text-realtor-primary underline"
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

      <section className="realtor-elevated-panel rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-realtor-text">
              QuickBooks Online
            </h2>
            <p className="mt-1 text-sm text-realtor-muted">
              When you click &quot;Send invoice&quot; on a booking, we upsert the
              realtor as a QB customer and create an invoice with line items
              from your pricing settings. Invoices land in QuickBooks exactly
              where your accountant expects them.
            </p>
          </div>
          {connection ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              Connected · {connection.environment}
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-realtor-primary/15 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-realtor-muted">
              Not connected
            </span>
          )}
        </div>

        {connection ? (
          <div className="mt-5 space-y-4">
            <dl className="grid gap-y-1 text-sm md:grid-cols-[180px_1fr]">
              <dt className="text-realtor-muted">Realm (company) id</dt>
              <dd className="text-realtor-text">
                <code className="text-xs">{connection.realm_id}</code>
              </dd>
              <dt className="text-realtor-muted">Connected</dt>
              <dd className="text-realtor-text">
                {new Date(connection.connected_at).toLocaleString()}
              </dd>
              <dt className="text-realtor-muted">Default service item</dt>
              <dd className="text-realtor-text">
                {connection.default_item_id ? (
                  items?.find((i) => i.Id === connection.default_item_id)?.Name ??
                  connection.default_item_id
                ) : (
                  <span className="text-amber-700">Not set — pick one below</span>
                )}
              </dd>
            </dl>

            {itemError ? (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
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
            <p className="text-sm text-realtor-muted">
              First-time setup:
            </p>
            <ol className="list-inside list-decimal space-y-1 text-sm text-realtor-muted">
              <li>
                Create an app at{" "}
                <a
                  className="text-realtor-primary underline"
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
