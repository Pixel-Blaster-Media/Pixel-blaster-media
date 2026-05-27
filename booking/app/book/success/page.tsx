import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BookingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const address = firstValue(params.address);
  const when = firstValue(params.when);

  return (
    <main className="realtor-elevated-panel rounded-3xl p-5 md:p-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
        Booking confirmed
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-realtor-text md:text-3xl">
        You are on the calendar.
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-realtor-muted">
        We recognized your realtor profile and confirmed the booking without
        making you sign into the portal. A confirmation email is on the way.
      </p>

      {address || when ? (
        <dl className="mt-6 grid gap-3 rounded-2xl border border-realtor-primary/15 bg-realtor-surface-muted/60 p-4 text-sm">
          {address ? (
            <div>
              <dt className="text-xs uppercase tracking-wider text-realtor-muted">
                Address
              </dt>
              <dd className="mt-1 font-medium text-realtor-text">{address}</dd>
            </div>
          ) : null}
          {when ? (
            <div>
              <dt className="text-xs uppercase tracking-wider text-realtor-muted">
                When
              </dt>
              <dd className="mt-1 font-medium text-realtor-text">{when}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/book"
          className="rounded-full bg-brand-light px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand"
        >
          Book another shoot
        </Link>
        <Link
          href="/portal"
          className="rounded-full border border-realtor-primary/20 px-5 py-2.5 text-sm text-realtor-muted transition hover:border-realtor-primary/35 hover:bg-realtor-surface"
        >
          Open portal
        </Link>
      </div>
    </main>
  );
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
