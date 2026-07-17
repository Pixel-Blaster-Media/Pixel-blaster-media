import Link from "next/link";

type SettingsSection = {
  href: string;
  title: string;
  description: string;
};

type SettingsGroup = {
  title: string;
  description: string;
  sections: readonly SettingsSection[];
};

export default function SettingsHub({
  groups,
}: {
  groups: readonly SettingsGroup[];
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {groups.map((group) => (
        <section
          key={group.title}
          className={
            group.title === "Platform administration"
              ? "overflow-hidden rounded-2xl border border-amber-200/80 bg-amber-50/45"
              : "overflow-hidden rounded-2xl border border-realtor-primary/12 bg-realtor-surface/75"
          }
        >
          <header className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
            <h2 className="text-base font-semibold text-realtor-text">
              {group.title}
            </h2>
            <p className="mt-1 text-sm leading-5 text-realtor-muted">
              {group.description}
            </p>
          </header>

          <div className="divide-y divide-realtor-primary/10 border-t border-realtor-primary/10">
            {group.sections.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="group flex min-h-20 items-center justify-between gap-4 bg-white/45 px-4 py-3.5 transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-realtor-primary sm:px-5"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-realtor-text">
                    {section.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-realtor-muted sm:text-sm">
                    {section.description}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-xl text-realtor-primary/55 transition group-hover:translate-x-0.5 group-hover:text-realtor-primary"
                >
                  →
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
