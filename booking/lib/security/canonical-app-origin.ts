const DEFAULT_CANONICAL_ORIGIN = "https://pixelblastermedia.com";

type PublicOriginEnvironment = {
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_ENV?: string;
};

function runtimeEnvironment(): PublicOriginEnvironment {
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
}

/**
 * Returns the configured browser-facing application origin. Generated Vercel
 * hosts and malformed values can never become public redirect targets.
 */
export function configuredCanonicalOrigin(
  environment: PublicOriginEnvironment = runtimeEnvironment(),
): URL {
  const fallback = new URL(DEFAULT_CANONICAL_ORIGIN);
  const configured = environment.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return fallback;

  try {
    const url = new URL(configured);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname.endsWith(".vercel.app")
    ) {
      return fallback;
    }
    return new URL(url.origin);
  } catch {
    return fallback;
  }
}

/**
 * Production requests may reach the booking app through an attested marketing
 * proxy while Next's request URL still names the internal upstream. Middleware
 * has already enforced that topology, so production redirects must use the
 * configured browser-facing origin. Preview/local redirects remain local.
 */
export function publicRedirectOrigin(
  requestUrl: string | URL,
  environment: PublicOriginEnvironment = runtimeEnvironment(),
): URL {
  if (environment.VERCEL_ENV === "production") {
    return configuredCanonicalOrigin(environment);
  }

  try {
    return new URL(new URL(requestUrl).origin);
  } catch {
    return configuredCanonicalOrigin(environment);
  }
}
