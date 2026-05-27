import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  createCompanyWorkspaceForExistingUser,
  normalizeCompanySlug,
} from "@/lib/platform/company-setup";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";

const FRESH_PROFILE_WINDOW_MS = 15 * 60 * 1000;

export default async function CompleteOAuthSignupPage() {
  if (process.env.ENABLE_PUBLIC_SIGNUP !== "1") notFound();

  const supabase = await getServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/start");
  }

  const email = user.email?.trim().toLowerCase();
  if (!email) {
    return <SetupError message="Google or Apple did not return an email address for this account." />;
  }

  const service = getServiceSupabase();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id, organization_id, role, full_name, created_at")
    .eq("id", user.id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      role: "admin" | "realtor";
      full_name: string | null;
      created_at: string;
    }>();

  if (profileError) {
    return <SetupError message={profileError.message} />;
  }

  if (profile?.role === "admin") {
    redirect("/admin/settings/business?welcome=1");
  }

  if (profile && !isFreshProfile(profile.created_at)) {
    return (
      <SetupError message="This email already belongs to an existing realtor account. For now, use a different email to create a company workspace." />
    );
  }

  const adminName = displayNameFromUser(user.user_metadata, profile?.full_name, email);
  const result = await createCompanyWorkspaceForExistingUser({
    userId: user.id,
    companyName: starterCompanyName(adminName),
    slug: starterCompanySlug(email),
    adminName,
    adminEmail: email,
    primaryColor: "#3f7f5f",
    accentColor: "#c9a35b",
    copyCatalog: true,
  });

  if (!result.ok) {
    return <SetupError message={result.error ?? "Company setup failed."} />;
  }

  redirect("/admin/settings/business?welcome=1");
}

function SetupError({ message }: { message: string }) {
  return (
    <div className="realtor-theme mx-auto max-w-xl">
      <section className="realtor-elevated-panel rounded-3xl p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary">
          Account created
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-realtor-text">
          We could not finish the company setup.
        </h1>
        <p className="mt-3 text-sm leading-6 text-realtor-muted">{message}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/start"
            className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </Link>
          <Link
            href="/auth/sign-in?next=/admin"
            className="rounded-full border border-realtor-primary/20 px-4 py-2 text-sm font-semibold text-realtor-text"
          >
            Sign in
          </Link>
        </div>
      </section>
    </div>
  );
}

function isFreshProfile(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && Date.now() - created < FRESH_PROFILE_WINDOW_MS;
}

function displayNameFromUser(
  metadata: Record<string, unknown>,
  profileName: string | null | undefined,
  email: string,
): string {
  const metaName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : profileName;
  return metaName?.trim() || email.split("@")[0] || "New owner";
}

function starterCompanyName(adminName: string): string {
  const firstName = adminName.trim().split(/\s+/)[0];
  return firstName ? `${firstName}'s Booking System` : "New Booking System";
}

function starterCompanySlug(adminEmail: string): string {
  const localPart = adminEmail.split("@")[0] || "company";
  const base = normalizeCompanySlug(localPart).slice(0, 32) || "company";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}
