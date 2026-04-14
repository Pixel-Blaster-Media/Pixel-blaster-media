import Link from "next/link";
import { notFound } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";
import { BOOKING_REQUEST_STATUSES } from "@/lib/booking/booking-status";
import {
  labelForAddOn,
  labelForService,
  PREFERRED_TIMES,
} from "@/lib/booking/services";
import type { Database } from "@/lib/supabase/database.types";

import RequestActions from "./RequestActions";

export const dynamic = "force-dynamic";

type BookingRequestRow =
  Database["public"]["Tables"]["booking_requests"]["Row"];

export default async function RequestDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = getServerSupabase();
  const { data: req, error } = await supabase
    .from("booking_requests")
    .select("*")
    .eq("id", params.id)
    .single<BookingRequestRow>();

  if (error || !req) notFound();

  const meta = BOOKING_REQUEST_STATUSES[req.status];
  const timeLabel =
    PREFERRED_TIMES.find((t) => t.id === req.preferred_time)?.label ??
    req.preferred_time ??
    "—";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Link
          href="/admin/inbox"
          className="text-xs text-ink-muted hover:text-white"
        >
          ← Inbox
        </Link>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
        >
          {meta.label}
        </span>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-white">{req.street_address}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {[req.city, req.postal_code].filter(Boolean).join(" ")}
          {req.square_footage ? ` · ${req.square_footage} sq ft` : ""}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Contact">
          <Row label="Name" value={req.contact_name} />
          <Row
            label="Email"
            value={
              <a
                href={`mailto:${req.contact_email}`}
                className="text-brand-light underline"
              >
                {req.contact_email}
              </a>
            }
          />
          <Row label="Phone" value={req.contact_phone ?? "—"} />
          <Row label="Brokerage" value={req.brokerage ?? "—"} />
        </Panel>

        <Panel title="Shoot">
          <Row
            label="Services"
            value={req.services.map(labelForService).join(", ") || "—"}
          />
          <Row
            label="Add-ons"
            value={
              req.add_ons.length
                ? req.add_ons.map(labelForAddOn).join(", ")
                : "—"
            }
          />
          <Row
            label="Preferred date"
            value={req.preferred_date ?? "—"}
          />
          <Row label="Preferred time" value={timeLabel} />
        </Panel>
      </div>

      {req.notes ? (
        <Panel title="Notes">
          <p className="whitespace-pre-wrap text-sm text-ink-muted">{req.notes}</p>
        </Panel>
      ) : null}

      <Panel title="Meta">
        <Row
          label="Submitted"
          value={new Date(req.created_at).toLocaleString()}
        />
        <Row label="Source" value={req.source ?? "—"} />
        <Row label="Request ID" value={<code className="text-xs">{req.id}</code>} />
        {req.booking_id ? (
          <Row
            label="Linked booking"
            value={
              <Link
                href={`/admin/bookings/${req.booking_id}`}
                className="text-brand-light underline"
              >
                Open booking →
              </Link>
            }
          />
        ) : null}
      </Panel>

      {req.status !== "accepted" ? (
        <RequestActions
          requestId={req.id}
          alreadyDeclined={req.status === "declined"}
          defaultDate={req.preferred_date ?? ""}
        />
      ) : null}
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-ink-soft/50 p-4">
      <p className="text-[11px] uppercase tracking-wider text-ink-muted">
        {title}
      </p>
      <div className="mt-3 space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-right text-white">{value}</span>
    </div>
  );
}
