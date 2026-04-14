import Link from "next/link";

import { getServerSupabase } from "@/lib/supabase/server";
import { BOOKING_REQUEST_STATUSES } from "@/lib/booking/booking-status";
import { labelForService } from "@/lib/booking/services";
import type { BookingRequestStatus } from "@/lib/supabase/database.types";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

interface InboxRow {
  id: string;
  status: BookingRequestStatus;
  contact_name: string;
  contact_email: string;
  brokerage: string | null;
  street_address: string;
  city: string | null;
  services: string[];
  preferred_date: string | null;
  created_at: string;
}

const FILTERS = [
  { id: "open", label: "Open" }, // new + reviewing
  { id: "all", label: "All" },
  { id: "accepted", label: "Accepted" },
  { id: "declined", label: "Declined" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

export default async function InboxPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const filter: FilterId =
    (FILTERS.find((f) => f.id === searchParams.filter)?.id as FilterId) ??
    "open";

  const supabase = getServerSupabase();
  let query = supabase
    .from("booking_requests")
    .select(
      "id, status, contact_name, contact_email, brokerage, street_address, city, services, preferred_date, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (filter === "open") {
    query = query.in("status", ["new", "reviewing"]);
  } else if (filter === "accepted") {
    query = query.eq("status", "accepted");
  } else if (filter === "declined") {
    query = query.eq("status", "declined");
  }

  const { data: requests, error } = await query.returns<InboxRow[]>();

  if (error) {
    return (
      <p className="text-sm text-red-300">
        Could not load inbox: {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
            Inbox
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">
            Booking requests
          </h1>
        </div>
        <nav className="flex gap-1 text-xs">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={`/admin/inbox?filter=${f.id}`}
              className={
                "rounded-md border px-3 py-1.5 transition " +
                (f.id === filter
                  ? "border-brand-light bg-brand/15 text-brand-light"
                  : "border-white/10 text-ink-muted hover:border-white/30 hover:text-white")
              }
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </header>

      {requests && requests.length > 0 ? (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-ink-soft/50">
          {requests.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/inbox/${r.id}`}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 transition hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">
                    {r.street_address}
                    {r.city ? (
                      <span className="text-ink-muted"> · {r.city}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {r.contact_name}
                    {r.brokerage ? ` · ${r.brokerage}` : ""} · {r.contact_email}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {r.services.map(labelForService).join(", ") || "No services"}
                    {r.preferred_date ? ` · prefers ${r.preferred_date}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill status={r.status} />
                  <span className="text-[10px] text-ink-muted">
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-white/10 bg-ink-soft/40 px-4 py-8 text-center text-sm text-ink-muted">
          No requests in this view.
        </p>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: keyof typeof BOOKING_REQUEST_STATUSES }) {
  const meta = BOOKING_REQUEST_STATUSES[status];
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
    >
      {meta.label}
    </span>
  );
}
