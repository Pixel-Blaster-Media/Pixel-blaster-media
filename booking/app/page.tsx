import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
          Hamilton, ON · Greater Toronto Area
        </p>
        <h1 className="mt-3 text-4xl font-bold leading-tight text-white md:text-6xl">
          Book the shoot.{" "}
          <span className="text-brand-light">Get everything in one place.</span>
        </h1>
        <p className="mt-6 text-lg text-ink-muted">
          Photography, iGuide virtual tours, and floor plans — scheduled,
          tracked, and delivered through one portal. No chasing Dropbox links or
          hunting for the tour URL.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/book"
            className="rounded-md bg-brand px-5 py-3 font-semibold text-white transition hover:bg-brand-light"
          >
            Book a Shoot
          </Link>
          <Link
            href="/portal"
            className="rounded-md border border-brand/40 px-5 py-3 font-semibold text-brand-light transition hover:border-brand-light hover:bg-brand/10"
          >
            Realtor Sign-In
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Feature
          title="Book online"
          body="Pick services, pick a time, pick add-ons. Phase 2 replaces Acuity with a native flow."
        />
        <Feature
          title="iGuide tours + floor plans"
          body="Auto-pulled into your property dashboard once they're published. No more hunting for links."
        />
        <Feature
          title="Fotello galleries"
          body="Your client gallery embedded right alongside the tour and floor plan for every listing."
        />
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-soft/60 p-6">
        <h2 className="text-lg font-semibold text-white">Roadmap</h2>
        <ol className="mt-4 grid gap-2 text-sm text-ink-muted md:grid-cols-2">
          <Phase n={1} label="Foundation (this PR)" done />
          <Phase n={2} label="Custom booking form + email confirmations" />
          <Phase n={3} label="Admin job-tracking dashboard" />
          <Phase n={4} label="iGuide API integration" />
          <Phase n={5} label="Fotello API integration" />
          <Phase n={6} label="Realtor magic-link portal" />
        </ol>
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-ink-soft/40 p-5">
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
    </div>
  );
}

function Phase({
  n,
  label,
  done = false,
}: {
  n: number;
  label: string;
  done?: boolean;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs " +
          (done
            ? "border-brand-light bg-brand/20 text-brand-light"
            : "border-white/15 text-ink-muted")
        }
        aria-hidden
      >
        {done ? "✓" : n}
      </span>
      <span className={done ? "text-white" : ""}>{label}</span>
    </li>
  );
}
