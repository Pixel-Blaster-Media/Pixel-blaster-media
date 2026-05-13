import Link from "next/link";

export default function Home() {
  return (
    <div className="realtor-theme space-y-16">
      <section className="max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
          Hamilton, ON · Greater Toronto Area
        </p>
        <h1 className="mt-3 text-4xl font-bold leading-tight text-realtor-text md:text-6xl">
          Book the shoot.{" "}
          <span className="text-realtor-primary">Get everything in one place.</span>
        </h1>
        <p className="mt-6 text-lg text-realtor-muted">
          Photography, iGuide virtual tours, and floor plans — scheduled,
          tracked, and delivered through one portal. No chasing Dropbox links or
          hunting for the tour URL.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/book"
            className="rounded-md bg-realtor-primary px-5 py-3 font-semibold text-white transition hover:bg-realtor-primary-light"
          >
            Book a Shoot
          </Link>
          <Link
            href="/portal"
            className="rounded-md border border-realtor-primary/40 px-5 py-3 font-semibold text-realtor-primary transition hover:border-realtor-primary hover:bg-realtor-primary/10"
          >
            Realtor Sign-In
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Feature
          title="Book online"
          body="Pick services, choose a time, and add the extras you need without the back-and-forth."
        />
        <Feature
          title="Everything tracked"
          body="Bookings, realtor details, shoot notes, invoices, tour links, and galleries stay organized in one dashboard."
        />
        <Feature
          title="Client portal"
          body="Realtors can come back for photos, iGuide tours, floor plans, video links, and listing website tools."
        />
      </section>

      <section className="realtor-elevated-panel rounded-2xl p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary">
          Built for real estate shoots
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-realtor-text">
          A cleaner handoff from booking to delivery.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-realtor-muted">
          The goal is simple: less admin work for Pixel Blaster, less confusion
          for realtors, and one reliable place for every deliverable after the
          shoot is done.
        </p>
        <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-realtor-primary">
          <span className="rounded-full bg-realtor-primary/10 px-3 py-1">Photos</span>
          <span className="rounded-full bg-realtor-primary/10 px-3 py-1">iGuide</span>
          <span className="rounded-full bg-realtor-primary/10 px-3 py-1">Floor plans</span>
          <span className="rounded-full bg-realtor-primary/10 px-3 py-1">Video</span>
          <span className="rounded-full bg-realtor-primary/10 px-3 py-1">Listing sites</span>
        </div>
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="realtor-warm-panel rounded-2xl p-5">
      <h3 className="font-semibold text-realtor-text">{title}</h3>
      <p className="mt-2 text-sm text-realtor-muted">{body}</p>
    </div>
  );
}

