import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/require-user";
import { getServiceSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Book a shoot" };
export const dynamic = "force-dynamic";

export default async function PortalBookRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await requireUser("/portal/book");
  const organizationSlug = await getOrganizationSlug(user.organizationId);

  const next = new URLSearchParams();
  if (organizationSlug) next.set("org", organizationSlug);
  copyParam(params, next, "services", "services");
  copyParam(params, next, "add_ons", "add_ons");
  copyParam(params, next, "slot", "slot");
  copyParam(params, next, "street_address", "address");
  copyParam(params, next, "unit_number", "unit");
  copyParam(params, next, "city", "city");
  copyParam(params, next, "postal_code", "postal");
  copyParam(params, next, "square_footage", "sqft");
  copyParam(params, next, "is_vacant", "vacant");
  copyParam(params, next, "include_basement", "basement");
  copyParam(params, next, "shoot_notes", "shoot_notes");

  const hasServices = Boolean(next.get("services"));
  const hasProperty = Boolean(next.get("address") && next.get("city"));
  const hasSlot = Boolean(next.get("slot"));
  const step = hasServices
    ? hasProperty
      ? hasSlot
        ? "/book/confirm"
        : "/book/schedule"
      : "/book/property"
    : "/book";
  const qs = next.toString();

  redirect(qs ? `${step}?${qs}` : step);
}

async function getOrganizationSlug(organizationId: string): Promise<string | null> {
  const { data } = await getServiceSupabase()
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .maybeSingle<{ slug: string | null }>();

  return data?.slug ?? null;
}

function copyParam(
  source: Record<string, string | string[] | undefined>,
  target: URLSearchParams,
  from: string,
  to: string,
) {
  const value = source[from];
  const clean = Array.isArray(value) ? value[0] : value;
  if (clean?.trim()) target.set(to, clean.trim());
}
