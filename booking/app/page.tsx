import Link from "next/link";

export default function Home() {
  return (
    <div className="realtor-theme space-y-10">
      <section className="mx-auto max-w-5xl py-6 text-center md:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-realtor-primary">
          Pixel Booking
        </p>
        <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-semibold leading-tight text-realtor-text md:text-6xl">
          A calmer booking system for real estate media teams.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-realtor-muted md:text-lg">
          Run online booking, calendar sync, realtor accounts, media delivery,
          listing pages, and AI-assisted admin work from one branded workspace.
        </p>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/start"
            className="rounded-full bg-realtor-primary px-7 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-realtor-text/10 transition hover:bg-realtor-primary/90"
          >
            Create account
          </Link>
          <Link
            href="/auth/sign-in?next=/admin"
            className="rounded-full border border-realtor-primary/25 bg-realtor-surface px-7 py-3 text-center text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/45 hover:bg-realtor-primary/10"
          >
            Sign in
          </Link>
        </div>

        <p className="mt-4 text-xs leading-5 text-realtor-muted">
          Beta access is open for testing. Subscriptions and billing come later.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Feature
          title="Booking"
          body="Realtors choose services, square footage, and available shoot times without back-and-forth."
        />
        <Feature
          title="Delivery"
          body="Photos, iGUIDE tours, floor plans, video links, invoices, and listing pages stay attached to each job."
        />
        <Feature
          title="AI admin"
          body="Ask the assistant to find bookings, prepare shoots, send delivery, or help plan the day."
        />
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="realtor-elevated-panel rounded-2xl p-5">
      <h2 className="font-semibold text-realtor-text">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-realtor-muted">{body}</p>
    </div>
  );
}
