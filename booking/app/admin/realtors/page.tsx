import type { Metadata } from "next";
import Link from "next/link";
import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import type { BookingStatus, Database, Json } from "@/lib/supabase/database.types";
import { parseRealtorAIMemory } from "@/lib/realtors/memory";
import AdminPageHeading from "../AdminPageHeading";
import RealtorProfileCard, { type RealtorProfileView } from "./RealtorProfileCard";

export const metadata: Metadata = { title: "Realtors" };
export const dynamic = "force-dynamic";

export default async function RealtorsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; after?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const after = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.after ?? "") ? params.after! : null;
  const admin = await requireAdmin();
  const supabase = await getServerSupabase();
  const args: Database["public"]["Functions"]["admin_realtor_search"]["Args"] = {
    p_organization_id: admin.organizationId, p_query: q, p_after: after,
  };
  // SSR 0.5 loses RPC inference; args remain checked against Database.
  const { data, error } = await supabase.rpc("admin_realtor_search", args as never);
  if (error) return <p className="text-sm text-red-700">Could not load realtors: {error.message}</p>;
  const rows = (data ?? []) as unknown as (Omit<RealtorProfileView, "ai_memory"> & { ai_memory: Json })[];
  const hasMore = rows.length > 50;
  const realtorViews = rows.slice(0, 50).map((profile) => ({
    ...profile,
    ai_memory: parseRealtorAIMemory(profile.ai_memory),
    latestBooking: profile.latestBooking ? {
      ...profile.latestBooking,
      status: BOOKING_STATUSES[profile.latestBooking.status as BookingStatus]?.label ?? profile.latestBooking.status,
    } : null,
  }));
  const nextParams = new URLSearchParams({ q, after: realtorViews.at(-1)?.id ?? "" });
  return (
    <div className="space-y-4">
      <AdminPageHeading
        eyebrow="Clients" title="Realtors"
        meta={`${realtorViews.length} profile${realtorViews.length === 1 ? "" : "s"} shown`}
        actions={
          <form className="flex w-full gap-2 sm:w-auto">
            <label className="sr-only" htmlFor="realtor-search">Search realtors</label>
            <input id="realtor-search" name="q" defaultValue={q}
              className="admin-input min-w-0 sm:w-72" placeholder="Search name, email, brokerage" />
            <button type="submit" className="min-h-11 rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white">Search</button>
          </form>
        }
      />
      <nav aria-label="Realtor result pages" className="flex flex-wrap gap-4 text-sm text-realtor-primary">
        <span>Up to 50 results per page · stable ID order · counts include full history</span>
        {after ? <Link href={`/admin/realtors?${new URLSearchParams({ q })}`}>First page</Link> : null}
        {hasMore ? <Link href={`/admin/realtors?${nextParams}`}>Next page</Link> : null}
      </nav>
      <div className="grid gap-4">
        {realtorViews.map((realtor) => <RealtorProfileCard key={realtor.id} realtor={realtor} />)}
      </div>
      {realtorViews.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-realtor-primary/20 bg-white/60 px-4 py-8 text-center text-sm text-realtor-muted">No realtors found.</p>
      ) : null}
    </div>
  );
}
