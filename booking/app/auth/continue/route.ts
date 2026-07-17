import { NextResponse, type NextRequest } from "next/server";

import {
  resolveAccountDestination,
  safeLoginRequestedPath,
  safePostAuthPath,
  type LoginAudience,
} from "@/lib/auth/account-destination";
import { isMissingSessionError } from "@/lib/auth/session-error";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";

interface ProfileRow {
  role: "admin" | "realtor";
  organization_id: string;
  archived_at: string | null;
}

interface MembershipRow {
  organization_id: string;
  role: "owner" | "admin" | "member";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const supabase = await getServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && !isMissingSessionError(userError)) {
    console.error("[auth/continue] Auth user verification failed", {
      name: userError.name,
      status: userError.status,
    });
    return NextResponse.redirect(authContextUrl("/auth/access-unavailable", url));
  }

  if (!user) {
    return NextResponse.redirect(authContextUrl("/auth/sign-in", url));
  }

  const service = getServiceSupabase();
  const [
    { data: profile, error: profileError },
    { data: memberships, error: membershipError },
  ] = await Promise.all([
    service
      .from("profiles")
      .select("role, organization_id, archived_at")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>(),
    service
      .from("organization_members")
      .select("organization_id, role")
      .eq("profile_id", user.id)
      .returns<MembershipRow[]>(),
  ]);

  if (profileError || membershipError) {
    console.error("[auth/continue] account access lookup failed", {
      profile: profileError?.code ?? null,
      membership: membershipError?.code ?? null,
    });
    return NextResponse.redirect(authContextUrl("/auth/access-unavailable", url));
  }

  const destination = resolveAccountDestination({
    profile: profile
      ? {
          role: profile.role,
          organizationId: profile.organization_id,
          archivedAt: profile.archived_at,
        }
      : null,
    memberships: (memberships ?? []).map((membership) => ({
      organizationId: membership.organization_id,
      role: membership.role,
    })),
    requestedPath: url.searchParams.get("next"),
  });

  const destinationUrl = new URL(destination, url.origin);
  if (url.searchParams.get("password_updated") === "1") {
    const confirmation = new URL("/auth/password-updated", url.origin);
    confirmation.searchParams.set(
      "next",
      destinationUrl.pathname + destinationUrl.search,
    );
    return NextResponse.redirect(confirmation);
  }
  return NextResponse.redirect(destinationUrl);
}

function authContextUrl(path: string, source: URL): URL {
  const destination = new URL(path, source.origin);
  const rawAudience = source.searchParams.get("audience");
  const audience: LoginAudience | null =
    rawAudience === "company" || rawAudience === "realtor"
      ? rawAudience
      : null;
  const requestedPath = source.searchParams.get("next");

  if (audience) {
    destination.searchParams.set("audience", audience);
    destination.searchParams.set(
      "next",
      safeLoginRequestedPath(audience, requestedPath),
    );
  } else if (requestedPath) {
    destination.searchParams.set("next", safePostAuthPath(requestedPath));
  }
  return destination;
}
