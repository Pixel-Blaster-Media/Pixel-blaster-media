export interface VerifiedSupabaseUser {
  id: string;
  aud: string;
  email?: string;
  role?: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  phone?: string;
  aal?: string | null;
  amr?: Array<Record<string, unknown>> | null;
}

interface VerificationResult {
  data: { user: VerifiedSupabaseUser | null };
  error: { name?: string; message?: string; status?: number } | null;
}

export interface VerifiedAccessTokenClaims {
  sub: string;
  aud: string;
  email?: string;
  role?: string;
  exp: number;
  iat: number;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  aal?: string;
  amr?: Array<Record<string, unknown>>;
  session_id?: string;
}

export class AuthTokenVerificationError extends Error {
  readonly kind: "malformed" | "invalid" | "unavailable";

  constructor(
    kind: "malformed" | "invalid" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AuthTokenVerificationError";
    this.kind = kind;
  }
}

const MAX_ACCESS_TOKEN_LENGTH = 16_384;

export async function requireVerifiedAccessToken(
  accessToken: string,
  verify: (accessToken: string) => Promise<VerificationResult>,
): Promise<VerifiedSupabaseUser> {
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > MAX_ACCESS_TOKEN_LENGTH
  ) {
    throw new AuthTokenVerificationError("malformed", "Invalid access token.");
  }

  let result: VerificationResult;
  try {
    result = await verify(accessToken);
  } catch {
    throw new AuthTokenVerificationError(
      "unavailable",
      "Authentication verification is temporarily unavailable.",
    );
  }

  if (result.error) {
    const status = result.error.status;
    const retryable =
      status === 0 ||
      status === 429 ||
      (typeof status === "number" && status >= 500) ||
      result.error.name?.includes("Retryable") === true ||
      result.error.name === "AuthUnknownError";
    throw new AuthTokenVerificationError(
      retryable ? "unavailable" : "invalid",
      retryable
        ? "Authentication verification is temporarily unavailable."
        : "Invalid access token.",
    );
  }
  if (!result.data.user?.id) {
    throw new AuthTokenVerificationError("invalid", "Invalid access token.");
  }

  return result.data.user;
}

export function parseVerifiedAccessTokenClaims(
  accessToken: string,
  verifiedUserId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedAccessTokenClaims {
  let value: unknown;
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3 || !parts[1]) {
      throw new Error("Malformed JWT");
    }
    value = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new AuthTokenVerificationError("malformed", "Malformed access token.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthTokenVerificationError("malformed", "Malformed access token claims.");
  }
  const claims = value as Partial<VerifiedAccessTokenClaims>;
  if (
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    typeof claims.aud !== "string" ||
    claims.aud.length === 0 ||
    typeof claims.exp !== "number" ||
    !Number.isInteger(claims.exp) ||
    typeof claims.iat !== "number" ||
    !Number.isInteger(claims.iat)
  ) {
    throw new AuthTokenVerificationError("malformed", "Malformed access token claims.");
  }
  if (claims.sub !== verifiedUserId) {
    throw new AuthTokenVerificationError(
      "invalid",
      "Verified access token subject mismatch.",
    );
  }
  if (claims.exp <= nowSeconds) {
    throw new AuthTokenVerificationError("invalid", "Verified access token expired.");
  }

  return claims as VerifiedAccessTokenClaims;
}
