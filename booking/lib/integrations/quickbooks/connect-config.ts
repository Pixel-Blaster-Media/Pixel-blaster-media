import type { QBOEnvironment } from "./oauth";

export const QUICKBOOKS_CALLBACK_PATH = "/api/integrations/quickbooks/callback";

type ConfigurationError = "not_configured" | "invalid_app_url" | "invalid_environment";
export type QuickBooksConnectConfiguration =
  | { ok: false; code: ConfigurationError; message: string }
  | {
      ok: true;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      environment: QBOEnvironment;
    };

/** Server callers share one preflight. Never send a successful result to a client. */
export function getQuickBooksConnectConfiguration(
  env: Record<string, string | undefined>,
): QuickBooksConnectConfiguration {
  const required = ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "NEXT_PUBLIC_APP_URL"] as const;
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) {
    return {
      ok: false,
      code: "not_configured",
      message: `QuickBooks connection setup is incomplete. Configure ${missing.join(", ")} on the booking app, then reload this page.`,
    };
  }
  const environment = env.QUICKBOOKS_ENVIRONMENT?.trim() || "sandbox";
  if (environment !== "sandbox" && environment !== "production") {
    return { ok: false, code: "invalid_environment", message: quickBooksConnectErrorMessage("invalid_environment") };
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL!.trim();
  let app: URL;
  try {
    app = new URL(appUrl);
  } catch {
    return { ok: false, code: "invalid_app_url", message: quickBooksConnectErrorMessage("invalid_app_url") };
  }
  const localSandbox = environment === "sandbox" && app.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname);
  if ((app.protocol !== "https:" && !localSandbox) || app.username || app.password ||
      app.search || app.hash || /[\s\\]/.test(appUrl)) {
    return { ok: false, code: "invalid_app_url", message: quickBooksConnectErrorMessage("invalid_app_url") };
  }
  return {
    ok: true,
    clientId: env.QUICKBOOKS_CLIENT_ID!.trim(),
    clientSecret: env.QUICKBOOKS_CLIENT_SECRET!.trim(),
    redirectUri: new URL(QUICKBOOKS_CALLBACK_PATH, app.origin).toString(),
    environment,
  };
}

/** Only allowlisted guidance is displayed; provider error text is never echoed. */
export function quickBooksConnectErrorMessage(code: string): string {
  switch (code) {
    case "not_configured":
      return "QuickBooks connection setup is incomplete. Check QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, and NEXT_PUBLIC_APP_URL on the booking app.";
    case "invalid_app_url":
      return "QuickBooks cannot connect because NEXT_PUBLIC_APP_URL is not a valid secure app URL. Correct it on the booking app, then try again.";
    case "invalid_environment":
      return "QUICKBOOKS_ENVIRONMENT must be sandbox or production. Use the matching Intuit app credentials.";
    case "state_mismatch":
    case "state_context_mismatch":
      return "The QuickBooks connection session expired or changed. Open Connections on the booking app and start again with the same admin account.";
    case "access_denied":
      return "QuickBooks access was not granted. Your existing connection has not been changed.";
    case "token_exchange_failed":
      return "QuickBooks could not complete authorization. Check that the Intuit credentials and registered redirect URI match this booking app, then try again.";
    case "persist_failed":
      return "QuickBooks authorized access, but the booking app could not save the connection. Contact the administrator before retrying.";
    default:
      return "QuickBooks could not start or complete the connection. Reload Connections and try again. If it continues, contact the administrator.";
  }
}
