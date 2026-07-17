const INTERNAL_ORIGIN = "https://internal.invalid";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type LoginAudience = "company" | "realtor";

type ProfileAccess = {
  role: "admin" | "realtor";
  organizationId: string;
  archivedAt: string | null;
};

type MembershipAccess = {
  organizationId: string;
  role: "owner" | "admin" | "member";
};

export function resolveAccountDestination({
  profile,
  memberships,
  requestedPath,
}: {
  profile: ProfileAccess | null;
  memberships: MembershipAccess[];
  requestedPath: string | null;
}): string {
  if (!profile || profile.archivedAt) return "/auth/no-workspace";

  const hasPrivilegedMembership = memberships.some(
    (membership) =>
      membership.organizationId === profile.organizationId &&
      (membership.role === "owner" || membership.role === "admin"),
  );

  if (hasPrivilegedMembership) {
    return safeWorkspacePath(requestedPath, "/admin");
  }
  if (profile.role === "realtor") {
    return safeWorkspacePath(requestedPath, "/portal");
  }
  return "/auth/no-workspace";
}

export function buildLoginContinuationPath(
  audience: LoginAudience,
  requestedPath: string | null,
): string {
  const next = safeLoginRequestedPath(audience, requestedPath);
  const params = new URLSearchParams({ audience, next });
  return `/auth/continue?${params.toString()}`;
}

export function safeLoginRequestedPath(
  audience: LoginAudience,
  requestedPath: string | null,
): string {
  try {
    const parsed = new URL(requestedPath ?? "", INTERNAL_ORIGIN);
    if (
      parsed.origin === INTERNAL_ORIGIN &&
      parsed.pathname === "/auth/continue" &&
      parsed.searchParams.get("audience") === audience
    ) {
      requestedPath = parsed.searchParams.get("next");
    }
  } catch {
    // The workspace-path validator below supplies the safe fallback.
  }
  return safeWorkspacePath(
    requestedPath,
    audience === "company" ? "/admin" : "/portal",
  );
}

export function safePostAuthPath(next: string | null): string {
  if (!next) return "/auth/continue";

  try {
    const parsed = new URL(next, INTERNAL_ORIGIN);
    if (
      parsed.origin === INTERNAL_ORIGIN &&
      parsed.pathname === "/auth/continue"
    ) {
      const audience = parsed.searchParams.get("audience");
      if (audience !== "company" && audience !== "realtor") {
        return "/auth/continue";
      }
      return buildLoginContinuationPath(
        audience,
        parsed.searchParams.get("next"),
      );
    }
  } catch {
    return "/auth/continue";
  }

  return normalizeInternalPath(next, "/auth/continue");
}

function safeWorkspacePath(requestedPath: string | null, root: "/admin" | "/portal") {
  const normalized = normalizeInternalPath(requestedPath, root);
  try {
    const parsed = new URL(normalized, INTERNAL_ORIGIN);
    if (parsed.pathname === root || parsed.pathname.startsWith(`${root}/`)) {
      return normalized;
    }
  } catch {
    // Fall back to the authorized workspace root.
  }
  return root;
}

function normalizeInternalPath(next: string | null, fallback: string): string {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    CONTROL_CHARACTERS.test(next)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(next, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN) return fallback;
    if (
      parsed.pathname.startsWith("/auth/") ||
      parsed.pathname.startsWith("/start/oauth/")
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
