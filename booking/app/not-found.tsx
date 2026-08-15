import Link from "next/link";

export default function NotFound() {
  return (
    <section className="realtor-theme -my-12 min-h-screen bg-realtor-bg px-4 py-20 text-realtor-text">
      <div className="mx-auto max-w-xl rounded-3xl border border-realtor-primary/15 bg-realtor-surface p-7 text-center shadow-xl shadow-realtor-text/10 sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary">
          Page unavailable
        </p>
        <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">
          This page doesn&apos;t exist.
        </h1>
        <p className="mt-3 text-sm leading-6 text-realtor-muted">
          The link may be old or the page may have moved. Your account and
          workspace have not been changed.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/auth/continue"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-realtor-primary-dark"
          >
            Continue to workspace
          </Link>
          <Link
            href="/auth/sign-in?audience=company&amp;next=%2Fadmin"
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-realtor-primary/25 bg-white px-5 py-2.5 text-sm font-semibold text-realtor-primary transition hover:bg-realtor-primary/5"
          >
            Sign in
          </Link>
        </div>
        <Link
          href="/"
          className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-realtor-muted underline decoration-realtor-primary/25 underline-offset-4 hover:text-realtor-primary"
        >
          Return home
        </Link>
      </div>
    </section>
  );
}
