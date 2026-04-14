import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Book a Shoot",
};

const SERVICES = [
  {
    name: "Real Estate Photography",
    blurb: "HDR interior + exterior, twilight on request.",
  },
  {
    name: "iGuide Virtual Tour",
    blurb: "3D tour with measured floor plans, delivered through your portal.",
  },
  {
    name: "Floor Plan",
    blurb: "Standalone iGuide-measured floor plan (no full tour).",
  },
  {
    name: "Drone / Aerial",
    blurb: "Aerial stills + short video clips. Weather permitting.",
  },
  {
    name: "Walkthrough Video",
    blurb: "Cinematic listing video, edited for social or MLS.",
  },
];

export default function BookPage() {
  return (
    <div className="space-y-10">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Step 1 of ~ · Phase 2 will wire this up
        </p>
        <h1 className="mt-3 text-3xl font-bold text-white md:text-4xl">
          Book a shoot
        </h1>
        <p className="mt-3 text-ink-muted">
          This is the scaffold for the multi-step booking flow. Phase 2 turns
          this into a working form (services → property details → date/time →
          contact → confirmation email) with submissions stored in Supabase.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
          Services
        </h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {SERVICES.map((s) => (
            <li
              key={s.name}
              className="rounded-lg border border-white/10 bg-ink-soft/50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{s.name}</p>
                  <p className="mt-1 text-sm text-ink-muted">{s.blurb}</p>
                </div>
                <span
                  aria-hidden
                  className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-muted"
                >
                  Soon
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-ink-muted">
        For now, please continue to use{" "}
        <a
          href="https://PixelBlaster.as.me/"
          className="underline"
          target="_blank"
          rel="noopener"
        >
          PixelBlaster.as.me
        </a>{" "}
        to book.
      </p>
    </div>
  );
}
