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
  const start = parseDate(firstValue(params.start));
  const end = parseDate(firstValue(params.end));
  const services = firstValue(params.services);
  const orgName = firstValue(params.org);
  const manageToken = firstValue(params.manage);

  const hasTimes = start !== null && end !== null;
  const googleCalendarHref = hasTimes
    ? googleCalendarTemplateUrl({
        title: `${orgName || "Pixel Blaster Media"} — media shoot`,
        start,
        end,
        location: address,
        details: services ? `Services: ${services}` : "",
      })
    : null;
  const icsHref = hasTimes
    ? `/book/success/ics?${new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
        address,
        services,
        org: orgName,
      }).toString()}`
    : null;

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

      {googleCalendarHref && icsHref ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={googleCalendarHref}
            target="_blank"
            rel="noopener noreferrer"
            className="tap-target rounded-full border border-realtor-primary/25 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/50 hover:bg-realtor-primary/5"
          >
            Add to Google Calendar
          </a>
          <a
            href={icsHref}
            className="tap-target rounded-full border border-realtor-primary/25 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:border-realtor-primary/50 hover:bg-realtor-primary/5"
          >
            Apple / Outlook (.ics)
          </a>
        </div>
      ) : null}

      <section className="mt-6 rounded-2xl border border-realtor-primary/15 bg-realtor-surface-muted/40 p-4">
        <h2 className="text-sm font-semibold text-realtor-text">
          What happens next
        </h2>
        <ol className="mt-3 space-y-2 text-sm text-realtor-muted">
          <NextStep n={1}>
            A confirmation email lands in your inbox right away with all the
            details.
          </NextStep>
          <NextStep n={2}>
            We&apos;ll reach out before the shoot if anything needs adjusting —
            otherwise, just make sure the property is photo-ready.
          </NextStep>
          <NextStep n={3}>
            Your media is delivered to your client portal, typically within 1–2
            business days after the shoot.
          </NextStep>
        </ol>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/book"
          className="tap-target rounded-full bg-brand-light px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand"
        >
          Book another shoot
        </Link>
        <Link
          href="/portal"
          className="tap-target rounded-full border border-realtor-primary/20 px-5 py-2.5 text-sm text-realtor-muted transition hover:border-realtor-primary/35 hover:bg-realtor-surface"
        >
          Open portal
        </Link>
      </div>

      {manageToken ? (
        <p className="mt-5 text-sm text-realtor-muted">
          Plans changed?{" "}
          <Link
            href={`/book/manage/${encodeURIComponent(manageToken)}`}
            className="font-medium text-realtor-primary underline"
          >
            Reschedule or cancel this booking
          </Link>{" "}
          — the same link is in your confirmation email.
        </p>
      ) : null}
    </main>
  );
}

function NextStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-realtor-primary/10 text-[11px] font-bold text-realtor-primary">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function googleCalendarTemplateUrl(args: {
  title: string;
  start: Date;
  end: Date;
  location: string;
  details: string;
}): string {
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: args.title,
    dates: `${fmt(args.start)}/${fmt(args.end)}`,
    location: args.location,
    details: args.details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
