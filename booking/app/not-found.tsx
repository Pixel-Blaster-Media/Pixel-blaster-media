import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-ink-soft/60 p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-light">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-white">
        That page does not exist.
      </h1>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        The link may be old, or the page may have moved. If you followed a
        booking or delivery link, double-check it or ask us to resend it.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/book"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-light"
        >
          Book a shoot
        </Link>
        <Link
          href="/"
          className="rounded-full border border-white/15 px-5 py-2.5 text-sm text-ink-muted transition hover:border-brand-light hover:text-white"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
