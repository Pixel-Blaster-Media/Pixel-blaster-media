import type { ReactNode } from "react";

export default function AdminPageHeading({
  eyebrow,
  title,
  mobileTitle,
  titleLabel,
  meta,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  mobileTitle?: ReactNode;
  titleLabel?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      data-admin-page-heading
      className="-mb-2 px-1 py-1 md:mb-0 md:py-0"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-realtor-primary/75 md:text-xs">
            {eyebrow}
          </p>
          <h1
            aria-label={titleLabel}
            className="min-w-0 text-2xl font-bold tracking-tight text-realtor-text"
          >
            {mobileTitle ? (
              <>
                <span className="whitespace-nowrap sm:hidden">{mobileTitle}</span>
                <span className="hidden sm:inline">{title}</span>
              </>
            ) : (
              title
            )}
          </h1>
          {meta ? (
            <>
              <span aria-hidden="true" className="text-realtor-muted/55">
                ·
              </span>
              <p className="whitespace-nowrap text-sm text-realtor-muted">
                {meta}
              </p>
            </>
          ) : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
