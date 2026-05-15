"use client";

import Link from "next/link";
import { useState } from "react";

type SettingsSection = {
  href: string;
  title: string;
  description: string;
  details: readonly string[];
};

export default function SettingsHub({
  sections,
}: {
  sections: readonly SettingsSection[];
}) {
  const [openHref, setOpenHref] = useState<string | null>(null);

  return (
    <>
      <section className="grid gap-3 md:hidden">
        {sections.map((section) => {
          const open = openHref === section.href;
          return (
            <article
              key={section.href}
              className={`rounded-2xl border bg-realtor-surface/80 shadow-sm shadow-realtor-text/5 transition ${
                open
                  ? "border-realtor-primary/35 p-5"
                  : "border-realtor-primary/15 p-4 hover:border-realtor-primary/35 hover:bg-realtor-surface"
              }`}
            >
              <button
                type="button"
                onClick={() => setOpenHref(open ? null : section.href)}
                className="flex w-full items-start justify-between gap-4 text-left"
                aria-expanded={open}
              >
                <span>
                  <span className="block text-sm font-semibold text-realtor-text">
                    {section.title}
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-realtor-muted">
                    {section.description}
                  </span>
                </span>
                <span className="shrink-0 rounded-full border border-realtor-primary/20 bg-realtor-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-realtor-primary">
                  {open ? "Hide" : "Open"}
                </span>
              </button>

              {open ? (
                <div className="mt-4 border-t border-realtor-primary/10 pt-4">
                  <ul className="space-y-2 text-sm text-realtor-muted">
                    {section.details.map((detail) => (
                      <li key={detail} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-realtor-primary/70" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={section.href}
                      className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90"
                    >
                      Edit {section.title}
                    </Link>
                    <button
                      type="button"
                      onClick={() => setOpenHref(null)}
                      className="rounded-full border border-realtor-primary/20 px-4 py-2 text-sm font-semibold text-realtor-primary transition hover:bg-realtor-primary/10"
                    >
                      Hide
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <section className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-4">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/80 p-4 shadow-sm shadow-realtor-text/5 transition hover:border-realtor-primary/35 hover:bg-realtor-surface"
          >
            <h2 className="text-sm font-semibold text-realtor-text">
              {section.title}
            </h2>
            <p className="mt-2 text-xs leading-5 text-realtor-muted">
              {section.description}
            </p>
            <span className="mt-4 inline-flex rounded-full border border-realtor-primary/20 px-3 py-1 text-xs font-semibold text-realtor-primary">
              Open
            </span>
          </Link>
        ))}
      </section>
    </>
  );
}
