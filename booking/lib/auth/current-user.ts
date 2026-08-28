import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import {
  getRequestVerifiedIdentity,
  type VerifiedIdentityUser,
} from "@/lib/auth/request-verified-identity";
import { supabaseSessionExpiryState } from "@/lib/auth/session-cookie-expiry";
import { getServerSupabase } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

export interface CurrentUserContext {
  userId: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  brokerage: string | null;
  profilePhotoUrl: string | null;
  role: UserRole;
}

export interface ActiveUserProfile extends CurrentUserContext {
  archivedAt: string | null;
}

export type CurrentUserResult =
  | {
      kind: "active";
      profile: ActiveUserProfile;
      verifiedIdentity: Readonly<VerifiedIdentityUser>;
    }
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "unavailable" }
  | { kind: "no_workspace" };

interface ProfileRow {
  id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  brokerage: string | null;
  profile_photo_url: string | null;
  role: UserRole;
  archived_at: string | null;
}

/**
 * Resolves authoritative identity and profile once per React Server Component
 * request. Protected guards preserve the detailed failure kind; the public root
 * layout consumes the optional projection below.
 */
export const getCurrentUserResult = cache(
  async function getCurrentUserResult(): Promise<CurrentUserResult> {
    const identity = await getRequestVerifiedIdentity();
    if (identity.kind !== "authenticated") return identity;

    try {
      const supabase = await getServerSupabase();
      const { data: profile, error } = await supabase
        .from("profiles")
        .select(
          "id, organization_id, email, full_name, phone, brokerage, profile_photo_url, role, archived_at",
        )
        .eq("id", identity.user.id)
        .maybeSingle<ProfileRow>();

      if (error) return { kind: "unavailable" };
      if (!profile) return { kind: "no_workspace" };

      return {
        kind: "active",
        verifiedIdentity: Object.freeze({
          id: identity.user.id,
          ...(typeof identity.user.email === "string"
            ? { email: identity.user.email }
            : {}),
        }),
        profile: {
          userId: profile.id,
          organizationId: profile.organization_id,
          email: profile.email,
          fullName: profile.full_name,
          phone: profile.phone,
          brokerage: profile.brokerage,
          profilePhotoUrl: profile.profile_photo_url,
          role: profile.role,
          archivedAt: profile.archived_at,
        },
      };
    } catch {
      return { kind: "unavailable" };
    }
  },
);

export const getCurrentUser = cache(
  async function getCurrentUser(): Promise<CurrentUserContext | null> {
    const cookieStore = await cookies();
    if (
      supabaseSessionExpiryState(
        cookieStore.getAll(),
        process.env.NEXT_PUBLIC_SUPABASE_URL,
      ) === "near_expiry"
    ) {
      // This optional root-layout projection can run on public RSC routes, where
      // cookie writes are unavailable. Do not let auth-js consume a rotating
      // refresh credential that cannot be persisted; protected GETs are handed
      // to the cookie-mutable refresh route by middleware before rendering.
      return null;
    }

    const result = await getCurrentUserResult();
    if (result.kind !== "active") return null;
    if (result.profile.role === "realtor" && result.profile.archivedAt) {
      return null;
    }

    const {
      userId,
      organizationId,
      email,
      fullName,
      phone,
      brokerage,
      profilePhotoUrl,
      role,
    } = result.profile;
    return {
      userId,
      organizationId,
      email,
      fullName,
      phone,
      brokerage,
      profilePhotoUrl,
      role,
    };
  },
);
