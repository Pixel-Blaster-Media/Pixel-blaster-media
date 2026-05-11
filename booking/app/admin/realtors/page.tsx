import type { Metadata } from "next";

import { BOOKING_STATUSES } from "@/lib/booking/booking-status";
import { getServerSupabase } from "@/lib/supabase/server";
import type { BookingStatus, UserRole } from "@/lib/supabase/database.types";

import RealtorProfileCard, {
  type RealtorProfileView,
} from "./RealtorProfileCard";

export const metadata: Metadata = { title: "Realtors" };
export const dynamic = "force-dynamic";

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  brokerage: string | null;
  profile_photo_url: string | null;
  brokerage_logo_url: string | null;
  website_url: string | null;
  instagram_url: string | null;
  delivery_cc_emails: string[];
  role: UserRole;
  created_at: string;
}

interface BookingRow {
  id: string;
  owner_id: string;
  status: BookingStatus;
  scheduled_at: string | null;
  created_at: string;
  properties: {
    street_address: string;
    city: string | null;
  } | null;
}

const ACTIVE_STATUSES = new Set<BookingStatus>([
  "requested",
  "confirmed",
  "shot",
  "editing",
]);

export default async function RealtorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const supabase = await getServerSupabase();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, phone, brokerage, profile_photo_url, brokerage_logo_url, website_url, instagram_url, delivery_cc_emails, role, created_at",
    )
    .eq("role", "realtor")
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true })
    .limit(300)
    .returns<ProfileRow[]>();

  if (error) {
    return (
      <p className="text-sm text-red-700">
        Could not load realtors: {error.message}
      </p>
    );
  }

  const filtered = (profiles ?? []).filter((profile) => {
    if (!q) return true;
    return [
      profile.full_name,
      profile.email,
      profile.phone,
      profile.brokerage,
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(q));
  });

  const profileIds = filtered.map((profile) => profile.id);
  const { data: bookings } =
    profileIds.length > 0
      ? await supabase
          .from("bookings")
          .select(
            "id, owner_id, status, scheduled_at, created_at, properties(street_address, city)",
          )
          .in("owner_id", profileIds)
          .order("created_at", { ascending: false })
          .limit(1000)
          .returns<BookingRow[]>()
      : { data: [] as BookingRow[] };

  const bookingsByOwner = new Map<string, BookingRow[]>();
  for (const booking of bookings ?? []) {
    bookingsByOwner.set(booking.owner_id, [
      ...(bookingsByOwner.get(booking.owner_id) ?? []),
      booking,
    ]);
  }

  const realtorViews = filtered.map((profile) =>
    buildRealtorView(profile, bookingsByOwner.get(profile.id) ?? []),
  );

  return (
    <div className="space-y-6">
      <header className="realtor-panel rounded-2xl p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
              Client profiles
            </p>
            <h1 className="mt-1 text-2xl font-bold text-realtor-text">
              Realtors
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-realtor-muted">
              Keep agent names, contact details, headshots, logos, and web
              links cleaned up for the portal and future listing page defaults.
            </p>
          </div>
          <form className="flex w-full gap-2 sm:w-auto">
            <input
              name="q"
              defaultValue={params.q ?? ""}
              className="admin-input min-w-0 sm:w-72"
              placeholder="Search name, email, brokerage"
            />
            <button
              type="submit"
              className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Search
            </button>
          </form>
        </div>
      </header>

      <div className="grid gap-4">
        {realtorViews.map((realtor) => (
          <RealtorProfileCard key={realtor.id} realtor={realtor} />
        ))}
      </div>

      {realtorViews.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-realtor-primary/20 bg-white/60 px-4 py-8 text-center text-sm text-realtor-muted">
          No realtors found.
        </p>
      ) : null}
    </div>
  );
}

function buildRealtorView(
  profile: ProfileRow,
  bookings: BookingRow[],
): RealtorProfileView {
  const sorted = [...bookings].sort((a, b) => {
    const aTime = Date.parse(a.scheduled_at ?? a.created_at);
    const bTime = Date.parse(b.scheduled_at ?? b.created_at);
    return bTime - aTime;
  });
  const latest = sorted[0] ?? null;

  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    phone: profile.phone,
    brokerage: profile.brokerage,
    profile_photo_url: profile.profile_photo_url,
    brokerage_logo_url: profile.brokerage_logo_url,
    website_url: profile.website_url,
    instagram_url: profile.instagram_url,
    delivery_cc_emails: profile.delivery_cc_emails,
    created_at: profile.created_at,
    bookingCount: bookings.length,
    activeBookingCount: bookings.filter((booking) =>
      ACTIVE_STATUSES.has(booking.status),
    ).length,
    deliveredBookingCount: bookings.filter(
      (booking) => booking.status === "delivered",
    ).length,
    latestBooking: latest
      ? {
          id: latest.id,
          address: formatAddress(latest),
          scheduled_at: latest.scheduled_at,
          status: BOOKING_STATUSES[latest.status]?.label ?? latest.status,
        }
      : null,
  };
}

function formatAddress(booking: BookingRow): string {
  const property = booking.properties;
  if (!property) return "Unknown address";
  return [property.street_address, property.city].filter(Boolean).join(", ");
}
