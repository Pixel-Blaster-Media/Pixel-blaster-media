import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/require-user";
import { getServiceSupabase } from "@/lib/supabase/server";
import RebookForm from "./RebookForm";

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
  const propertyId = firstParam(params.from_property);
  const bookingId = firstParam(params.from_booking);
  if (propertyId) {
    // Legacy bookmarks may contain private fields. Strip them before displaying
    // the explicit POST handoff; the action reloads owned data from the database.
    if (Object.keys(params).some((key) => !["from_property", "from_booking", "rebook_error"].includes(key))) {
      const clean = new URLSearchParams({ from_property: propertyId });
      if (bookingId) clean.set("from_booking", bookingId);
      redirect(`/portal/book?${clean.toString()}`);
    }
    return <main className="space-y-4"><h1 className="text-xl font-semibold">Book another shoot</h1>
      <p>Review the property details and choose a new time.</p>
      {firstParam(params.rebook_error) === "draft_unavailable" ? <p role="alert">Your booking draft could not be opened. Please try again.</p> : null}
      <RebookForm propertyId={propertyId} bookingId={bookingId || undefined} />
    </main>;
  }

  const next = new URLSearchParams();
  if (organizationSlug) next.set("org", organizationSlug);
  copyParam(params, next, "services", "services");
  copyParam(params, next, "add_ons", "add_ons");

  const hasServices = Boolean(next.get("services"));
  const step = hasServices ? "/book/property" : "/book";
  const qs = next.toString();

  redirect(qs ? `${step}?${qs}` : step);
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
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
