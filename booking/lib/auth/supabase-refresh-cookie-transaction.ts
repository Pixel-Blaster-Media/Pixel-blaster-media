import {
  getSupabaseAuthCookieBaseName,
  isSupabaseAuthCookieName,
} from "./supabase-auth-cookie-family.ts";
import { SUPABASE_SESSION_REFRESH_SKEW_SECONDS } from "./session-cookie-expiry.ts";
import { parseVerifiedAccessTokenClaims } from "./verified-access-token.ts";

export interface SupabaseRefreshTokenCandidate {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export interface SupabaseRefreshCookieMutation<TOptions = unknown> {
  name: string;
  value: string;
  options: TOptions;
}

export interface SupabaseAuthUserProof {
  accessToken: string | null;
  bytes: ArrayBuffer | null;
  ok: boolean;
}

type TransactionPhase =
  | "idle"
  | "candidate"
  | "staged"
  | "unavailable"
  | "terminal"
  | "rolled_back"
  | "committed";

interface StagedSession {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: number;
  expires_in: number;
  user: { id: string };
}

export function createSupabaseRefreshCookieTransaction<TOptions>(
  supabaseUrl: string,
  commit: (
    mutations: readonly SupabaseRefreshCookieMutation<TOptions>[],
  ) => void,
) {
  const authBase = getSupabaseAuthCookieBaseName(supabaseUrl);
  let phase: TransactionPhase = "idle";
  let candidate: SupabaseRefreshTokenCandidate | null = null;
  let stagedMutations: SupabaseRefreshCookieMutation<TOptions>[] | null = null;
  let stagedSession: StagedSession | null = null;

  function rollBack(nextPhase: "unavailable" | "terminal" | "rolled_back") {
    phase = nextPhase;
    candidate = null;
    stagedMutations = null;
    stagedSession = null;
  }

  return {
    acceptRefreshCandidate(value: SupabaseRefreshTokenCandidate): void {
      if (!validCandidate(value)) {
        rollBack("rolled_back");
        return;
      }
      phase = "candidate";
      candidate = { ...value };
      stagedMutations = null;
      stagedSession = null;
    },

    failRefresh(kind: "unavailable" | "terminal"): void {
      rollBack(kind);
    },

    processCookieMutations(
      mutations: readonly SupabaseRefreshCookieMutation<TOptions>[],
    ): SupabaseRefreshCookieMutation<TOptions>[] {
      if (!authBase) {
        rollBack("rolled_back");
        return mutations.filter((mutation) => !mutation.value);
      }
      const authMutations = mutations.filter((mutation) =>
        isSupabaseAuthCookieName(mutation.name, authBase),
      );
      const auxiliaryMutations = mutations.filter(
        (mutation) => !isSupabaseAuthCookieName(mutation.name, authBase),
      );
      const positiveAuth = authMutations.filter((mutation) => mutation.value);

      if (
        (phase === "candidate" || phase === "staged") &&
        authMutations.length > 0 &&
        positiveAuth.length === 0
      ) {
        // A sign-out that followed an implicit refresh must discard the staged
        // replacement and still clear the original browser session.
        phase = "idle";
        candidate = null;
        stagedMutations = null;
        stagedSession = null;
        return [...mutations];
      }

      if (phase === "candidate" && positiveAuth.length > 0 && candidate) {
        const session = stagedSessionFromMutations(
          positiveAuth,
          authBase,
        );
        if (!session || !sessionMatchesCandidate(session, candidate)) {
          rollBack("rolled_back");
          return auxiliaryMutations;
        }
        phase = "staged";
        stagedMutations = [...authMutations];
        stagedSession = session;
        return auxiliaryMutations;
      }

      if (phase === "staged" && positiveAuth.length > 0) {
        // Auth JS must produce at most one replacement family for one exchange.
        rollBack("rolled_back");
        return auxiliaryMutations;
      }

      if (
        phase === "unavailable" ||
        phase === "terminal" ||
        phase === "rolled_back"
      ) {
        // A failed refresh response may race with a successful rotation from a
        // different request. Never let the loser emit Auth-cookie mutations;
        // response headers cannot compare-and-swap against the browser's cookie.
        return auxiliaryMutations;
      }
      return [...mutations];
    },

    processAuthUserProof(proof: SupabaseAuthUserProof): boolean {
      if (
        phase !== "staged" ||
        !candidate ||
        !stagedMutations ||
        !stagedSession ||
        !proof.ok ||
        !proof.bytes ||
        proof.accessToken !== candidate.accessToken
      ) {
        if (phase === "candidate" || phase === "staged") {
          rollBack("rolled_back");
          return false;
        }
        return true;
      }

      try {
        const user = parseVerifiedUser(proof.bytes);
        const claims = parseVerifiedAccessTokenClaims(
          candidate.accessToken,
          user.id,
        );
        const nowSeconds = Math.floor(Date.now() / 1_000);
        const expectedExpiresIn = claims.exp - nowSeconds;
        if (
          candidate.userId !== user.id ||
          stagedSession.user.id !== user.id ||
          stagedSession.expires_at !== claims.exp ||
          expectedExpiresIn <= SUPABASE_SESSION_REFRESH_SKEW_SECONDS ||
          Math.abs(stagedSession.expires_in - expectedExpiresIn) > 10
        ) {
          rollBack("rolled_back");
          return false;
        }

        commit(stagedMutations);
        phase = "committed";
        candidate = null;
        stagedMutations = null;
        stagedSession = null;
        return true;
      } catch {
        rollBack("rolled_back");
        return false;
      }
    },
  };
}

function validCandidate(value: SupabaseRefreshTokenCandidate): boolean {
  return (
    typeof value.accessToken === "string" &&
    value.accessToken.length > 0 &&
    value.accessToken.length <= 16_384 &&
    typeof value.refreshToken === "string" &&
    value.refreshToken.length > 0 &&
    value.refreshToken.length <= 16_384 &&
    typeof value.userId === "string" &&
    value.userId.length > 0 &&
    value.userId.length <= 256
  );
}

function sessionMatchesCandidate(
  session: StagedSession,
  candidate: SupabaseRefreshTokenCandidate,
): boolean {
  return (
    session.access_token === candidate.accessToken &&
    session.refresh_token === candidate.refreshToken &&
    session.token_type.toLowerCase() === "bearer" &&
    session.user.id === candidate.userId
  );
}

function stagedSessionFromMutations<TOptions>(
  mutations: readonly SupabaseRefreshCookieMutation<TOptions>[],
  authBase: string,
): StagedSession | null {
  const primary = mutations.filter((mutation) => mutation.name === authBase);
  const chunks = mutations.filter((mutation) => mutation.name !== authBase);
  let encoded: string;
  if (primary.length === 1 && chunks.length === 0) {
    encoded = primary[0].value;
  } else if (primary.length === 0 && chunks.length > 0) {
    const indexed = chunks
      .map((mutation) => {
        const suffix = mutation.name.slice(authBase.length + 1);
        return { mutation, index: Number(suffix) };
      })
      .sort((left, right) => left.index - right.index);
    if (
      indexed.some(
        (item, position) =>
          !Number.isInteger(item.index) || item.index !== position,
      )
    ) {
      return null;
    }
    encoded = indexed.map((item) => item.mutation.value).join("");
  } else {
    return null;
  }

  if (!encoded.startsWith("base64-")) return null;
  try {
    const value = JSON.parse(
      Buffer.from(encoded.slice("base64-".length), "base64url").toString("utf8"),
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const session = value as Record<string, unknown>;
    const user = session.user;
    if (
      typeof session.access_token !== "string" ||
      typeof session.refresh_token !== "string" ||
      typeof session.token_type !== "string" ||
      !Number.isSafeInteger(session.expires_at) ||
      !Number.isSafeInteger(session.expires_in) ||
      !user ||
      typeof user !== "object" ||
      Array.isArray(user) ||
      typeof (user as Record<string, unknown>).id !== "string"
    ) {
      return null;
    }
    return session as unknown as StagedSession;
  } catch {
    return null;
  }
}

function parseVerifiedUser(bytes: ArrayBuffer): { id: string } {
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid verified user response.");
  }
  const user = value as Record<string, unknown>;
  if (
    typeof user.id !== "string" ||
    user.id.length === 0 ||
    user.id.length > 256
  ) {
    throw new Error("Invalid verified user response.");
  }
  return { id: user.id };
}
