import Link from "next/link";
import type { Metadata } from "next";

import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import { BUSINESS_TZ } from "@/lib/booking/availability";
import {
  labelForService,
  totalDurationMinutes,
} from "@/lib/booking/services";
import { getServerSupabase } from "@/lib/supabase/server";
import type { BookingStatus } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

interface BookingRow {
  id: string;
  status: BookingStatus;
  scheduled_at: string;
  services: string[];
  add_ons: string[];
  properties: { street_address: string } | null;
  profiles: { full_name: string | null; email: string } | null;
}

interface BlockRow {
  id: string;
  starts_at: string;
  ends_at: string;
  label: string | null;
}

type AgendaItem =
  | { kind: "booking"; at: Date; minutes: number; row: BookingRow }
  | { kind: "block"; at: Date; minutes: number; row: BlockRow };

export default async function AdminCalendarPage() {
  const supabase = getServerSupabase();
  const now = new Date();
  const in60Days = new Date(now);
  in60Days.setDate(in60Days.getDate() + 60);

  const [bookingsRes, blocksRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, status, scheduled_at, services, add_ons, properties(street_address), profiles(full_name, email)",
      )
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", now.toISOString())
      .lt("scheduled_at", in60Days.toISOString())
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true })
      .returns<BookingRow[]>(),
    supabase
      .from("calendar_blocks")
      .select("id, starts_at, ends_at, label")
      .gte("ends_at", now.toISOString())
      .lt("starts_at", in60Days.toISOString())
      .order("starts_at")
      .returns<BlockRow[]>(),
  ]);

  const items: AgendaItem[] = [];
  for (const b of bookingsRes.data ?? []) {
    items.push({
      kind: "booking",
      at: new Date(b.scheduled_at),
      minutes: Math.max(totalDurationMinutes(b.services, b.add_ons), 60),
      row: b,
    });
  }
  for (const bl of blocksRes.data ?? []) {
    const start = new Date(bl.starts_at);
    const end = new Date(bl.ends_at);
    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    items.push({ kind: "block", at: start, minutes, row: bl });
  }
  items.sort((a, b) => a.at.getTime() - b.at.getTime());

  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayHeaderFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  });

  const byDay = new Map<string, { header: string; items: AgendaItem[] }>();
  for (const it of items) {
    const key = dayKeyFmt.format(it.at);
    if (!byDay.has(key)) {
      byDay.set(key, { header: dayHeaderFmt.format(it.at), items: [] });
    }
    byDay.get(key)!.items.push(it);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
            Next 60 days
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">Calendar</h1>
        </div>
        <div className="flex gap-2 text-xs">
          <Link
            href="/admin/settings/availability"
            className="rounded-md border border-white/10 px-3 py-1.5 text-ink-muted hover:border-white/30 hover:text-white"
          >
            Edit hours + blocks →
          </Link>
        </div>
      </header>

      {byDay.size === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 bg-ink-soft/40 p-6 text-center text-sm text-ink-muted">
          Nothing scheduled in the next 60 days.
        </p>
      ) : (
        <div className="space-y-6">
          {Array.from(byDay.values()).map((day) => (
            <div key={day.header}>
              <p className="text-sm font-semibold text-white">{day.header}</p>
              <ul className="mt-2 space-y-2">
                {day.items.map((it, i) => (
                  <li key={i}>
                    {it.kind === "booking" ? (
                      <BookingRowItem
                        item={it}
                        timeLabel={timeFmt.format(it.at)}
                      />
                    ) : (
                      <BlockRowItem
                        item={it}
                        timeLabel={timeFmt.format(it.at)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BookingRowItem({
  item,
  timeLabel,
}: {
  item: Extract<AgendaItem, { kind: "booking" }>;
  timeLabel: string;
}) {
  const meta = BOOKING_STATUSES[item.row.status];
  const realtor =
    item.row.profiles?.full_name ?? item.row.profiles?.email ?? "Unknown";
  const address = item.row.properties?.street_address ?? "—";

  return (
    <Link
      href={`/admin/bookings/${item.row.id}`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/20 bg-brand/5 px-4 py-3 hover:border-brand-light/60"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">
          <span className="text-brand-light">{timeLabel}</span>{" "}
          <span className="text-ink-muted">· {item.minutes}m</span>{" "}
          · {address}
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {realtor} · {item.row.services.map(labelForService).join(", ")}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${meta.pill}`}
      >
        {meta.label}
      </span>
    </Link>
  );
}

function BlockRowItem({
  item,
  timeLabel,
}: {
  item: Extract<AgendaItem, { kind: "block" }>;
  timeLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-ink-soft/30 px-4 py-3">
      <div>
        <p className="text-sm text-white">
          <span className="text-ink-muted">{timeLabel}</span>{" "}
          <span className="text-ink-muted">· {item.minutes}m block</span>
        </p>
        {item.row.label ? (
          <p className="mt-0.5 text-xs text-ink-muted">{item.row.label}</p>
        ) : null}
      </div>
    </div>
  );
}
