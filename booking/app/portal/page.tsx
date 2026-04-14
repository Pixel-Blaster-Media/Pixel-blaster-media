import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Realtor Portal",
};

export default function PortalPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Realtor Portal
        </p>
        <h1 className="mt-3 text-3xl font-bold text-white md:text-4xl">
          Sign in to view your shoots
        </h1>
        <p className="mt-3 text-ink-muted">
          Phase 6 wires this up with magic-link email auth via Supabase. Once
          signed in, you'll see every property you've booked, with photos
          (Fotello), virtual tour, and floor plan (iGuide) embedded for each.
        </p>
      </header>

      <div className="rounded-lg border border-dashed border-white/10 bg-ink-soft/40 p-6 text-sm text-ink-muted">
        <p className="font-semibold text-white">Coming in Phase 6</p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Magic-link sign-in (no passwords)</li>
          <li>Property list with status badges</li>
          <li>Per-property page with embedded gallery + tour + floor plan</li>
          <li>Download links for full-res photos and floor plan PDF</li>
        </ul>
      </div>
    </div>
  );
}
