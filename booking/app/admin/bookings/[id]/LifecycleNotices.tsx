import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";

export default async function LifecycleNotices({ bookingId }: { bookingId: string }) {
  const admin = await requireAdmin();
  const { data, error } = await getServiceSupabase().from("booking_lifecycle_notices")
    .select("id, event, recipient, status, created_at")
    .eq("organization_id", admin.organizationId).eq("booking_id", bookingId)
    .order("created_at", { ascending: false }).limit(10);
  if (error) return <p role="status" className="text-sm text-amber-800">Booking notification status is temporarily unavailable.</p>;
  if (!data?.length) return null;
  const needsAttention = data.some((notice) => notice.status === "dead_letter");
  return (
    <section aria-label="Booking change notifications" className="realtor-elevated-panel rounded-2xl p-4 text-sm">
      <h2 className="font-semibold">Booking change notifications</h2>
      <ul className="mt-2 space-y-1">
        {data.map((notice) => (
          <li key={notice.id}>
            {notice.event === "cancelled" ? "Cancellation" : "Reschedule"} · {notice.recipient === "realtor" ? "Customer" : "Studio"}: {label(notice.status)}
          </li>
        ))}
      </ul>
      {needsAttention ? <p className="mt-2 text-amber-800">An email needs attention. Check the email provider for a receipt before arranging another notification, to avoid sending it twice.</p> : null}
    </section>
  );
}

function label(status: string): string {
  if (status === "completed") return "Accepted by email provider";
  if (status === "superseded") return "Replaced by a newer change or notification preference";
  if (status === "dead_letter") return "Delivery unconfirmed — needs attention";
  if (status === "processing") return "Sending";
  return "Waiting to send or retry";
}
