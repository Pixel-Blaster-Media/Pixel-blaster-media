import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminPage() {
  // Phase 3 will gate this on a Supabase session with role = 'admin'
  // and render the real job board. For now this is just a marker route
  // so the URL exists and the layout works.
  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Admin
        </p>
        <h1 className="mt-3 text-3xl font-bold text-white md:text-4xl">
          Job board (Phase 3)
        </h1>
        <p className="mt-3 text-ink-muted">
          This will become your daily driver: every booking, every property,
          status pipeline (booked → shot → editing → delivered), and a place to
          paste deliverable URLs manually as a fallback when the iGuide /
          Fotello sync hasn't fired yet.
        </p>
      </header>

      <div className="rounded-lg border border-dashed border-white/10 bg-ink-soft/40 p-6 text-sm text-ink-muted">
        <p className="font-semibold text-white">Will include</p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Today / This week views</li>
          <li>Status pipeline per booking</li>
          <li>Manual deliverable entry (paste iGuide URL, Fotello URL)</li>
          <li>Resend client notification email</li>
          <li>Realtor account management</li>
        </ul>
      </div>
    </div>
  );
}
