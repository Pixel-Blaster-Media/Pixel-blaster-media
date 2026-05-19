import Link from "next/link";

export default function Home() {
  return (
    <div className="realtor-theme space-y-12">
      <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold leading-tight text-realtor-text md:text-6xl">
            Real estate media booking, delivery, and client portals in one calm
            place.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-realtor-muted md:text-lg">
            Pixel Booking helps photography companies run online scheduling,
            realtor accounts, media delivery, listing pages, calendar sync, and
            AI-assisted admin work from one branded workspace.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/start"
              className="rounded-full bg-realtor-primary px-6 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-realtor-text/10 transition hover:bg-realtor-primary/90"
            >
              Create account
            </Link>
            <Link
              href="/auth/sign-in?next=/admin"
              className="rounded-full border border-realtor-primary/25 bg-realtor-surface px-6 py-3 text-center text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/45 hover:bg-realtor-primary/10"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-3 text-xs leading-5 text-realtor-muted">
            Beta note: subscriptions come later. For now, create your company,
            set branding, connect calendar, and start testing the workflow.
          </p>
        </div>

        <div className="realtor-elevated-panel rounded-3xl p-5 md:p-6">
          <div className="rounded-2xl border border-realtor-primary/15 bg-realtor-primary/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary">
              Start here
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-realtor-text">
              Which door do you need?
            </h2>
          </div>
          <div className="mt-4 grid gap-3">
            <FrontDoorCard
              title="I run a media company"
              body="Create your own booking system with your colors, packages, calendar, and agents."
              href="/start"
              action="Create company"
              primary
            />
            <FrontDoorCard
              title="I already have an account"
              body="Open the admin dashboard or realtor portal with your login."
              href="/auth/sign-in?next=/admin"
              action="Sign in"
            />
            <FrontDoorCard
              title="I am a realtor booking Pixel Blaster"
              body="Book a shoot or open delivered media from Pixel Blaster's current portal."
              href="/book"
              action="Book a shoot"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Feature
          title="Acuity-style booking"
          body="Realtors pick services, square footage, and a time while your calendar blocks double-booking."
        />
        <Feature
          title="Delivery portal"
          body="Photos, iGUIDE tours, floor plans, video links, invoices, and listing pages stay attached to the job."
        />
        <Feature
          title="Company workspaces"
          body="Each beta company gets its own settings, branding, catalog, realtors, and integrations."
        />
      </section>

      <section className="realtor-warm-panel rounded-3xl p-5 md:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold text-realtor-text">
              Realtors still get the simple path.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-realtor-muted">
              If someone is only here to book a Pixel Blaster shoot or open
              delivered media, those links stay one click away.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href="/book"
              className="rounded-full border border-realtor-primary/25 bg-white px-5 py-2.5 text-center text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/45 hover:bg-realtor-primary/5"
            >
              Book Pixel Blaster
            </Link>
            <Link
              href="/portal"
              className="rounded-full border border-realtor-primary/25 bg-white px-5 py-2.5 text-center text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/45 hover:bg-realtor-primary/5"
            >
              Client portal
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function FrontDoorCard({
  title,
  body,
  href,
  action,
  primary = false,
}: {
  title: string;
  body: string;
  href: string;
  action: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group rounded-2xl border p-4 transition ${
        primary
          ? "border-realtor-primary/30 bg-realtor-primary/10 hover:bg-realtor-primary/15"
          : "border-realtor-primary/15 bg-white/70 hover:border-realtor-primary/35 hover:bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-realtor-text">{title}</h3>
          <p className="mt-1 text-sm leading-5 text-realtor-muted">{body}</p>
        </div>
        <span className="shrink-0 rounded-full border border-realtor-primary/20 px-3 py-1 text-xs font-semibold text-realtor-primary transition group-hover:bg-realtor-primary group-hover:text-white">
          {action}
        </span>
      </div>
    </Link>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="realtor-elevated-panel rounded-2xl p-5">
      <h3 className="font-semibold text-realtor-text">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-realtor-muted">{body}</p>
    </div>
  );
}
