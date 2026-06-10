"use client";

import { useState, useTransition } from "react";

import {
  generateTodayAIBrief,
  type TodayAIBrief,
} from "./actions";

export default function DailyAIBriefPanel() {
  const [brief, setBrief] = useState<TodayAIBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mt-4 rounded-2xl border border-realtor-primary/20 bg-realtor-primary/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-realtor-primary">
            AI daily brief
          </p>
          <p className="mt-1 text-sm text-realtor-muted">
            {brief
              ? isCollapsed
                ? "Brief is ready and hidden."
                : "Brief is expanded below."
              : "Generate a practical shoot-day plan when you need one."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {brief ? (
            <button
              type="button"
              onClick={() => setIsCollapsed((value) => !value)}
              className="rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-xs font-semibold text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
            >
              {isCollapsed ? "Show brief" : "Hide brief"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await generateTodayAIBrief();
                if (result.ok) {
                  setBrief(result.brief);
                  setIsCollapsed(false);
                } else {
                  setBrief(null);
                  setError(result.error);
                }
              });
            }}
            className="rounded-full bg-realtor-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-realtor-primary/90 disabled:opacity-60"
          >
            {isPending ? "Building..." : brief ? "Refresh" : "Generate brief"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error}
        </p>
      ) : null}

      {brief && !isCollapsed ? (
        <div className="mt-4 space-y-3">
          <p className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3 text-sm leading-6 text-realtor-text">
            {brief.overview}
          </p>

          <div className="grid gap-3 lg:grid-cols-3">
            <BriefList title="Focus" items={brief.focus} />
            <BriefList title="Watch-outs" items={brief.warnings} />
            <BriefList title="Route plan" items={brief.routePlan} />
          </div>

          {brief.perShoot.length > 0 ? (
            <div className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Shoot-by-shoot
              </p>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                {brief.perShoot.map((shoot) => (
                  <a
                    key={shoot.bookingId}
                    href={`/admin/bookings/${shoot.bookingId}`}
                    className="block rounded-2xl border border-realtor-primary/15 bg-white/65 p-3 transition hover:border-realtor-primary/45"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-realtor-text">
                          {shoot.title}
                        </p>
                        <p className="mt-0.5 text-xs text-realtor-muted">
                          {shoot.time} · {shoot.address}
                        </p>
                        <p className="text-xs text-realtor-muted">{shoot.realtor}</p>
                      </div>
                      <span className="rounded-full border border-realtor-primary/15 px-2 py-0.5 text-[10px] text-realtor-muted">
                        Open
                      </span>
                    </div>
                    <ul className="mt-3 space-y-1.5 text-sm text-realtor-muted">
                      {shoot.bullets.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-realtor-primary" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <BriefList title="After the shoots" items={brief.afterShoot} />
        </div>
      ) : null}
    </div>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-realtor-primary/15 bg-white/65 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
        {title}
      </p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5 text-sm text-realtor-muted">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-realtor-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-realtor-muted">Nothing flagged.</p>
      )}
    </div>
  );
}
