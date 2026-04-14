"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { ADD_ONS, SERVICES } from "@/lib/booking/services";

/**
 * Multi-select for services + add-ons. Drives the URL (?services=a,b).
 *
 * Writing to the URL instead of component state means:
 *   - the parent (server) component re-renders with new slots automatically
 *   - the realtor can bookmark / share a pre-filled booking link
 *   - browser back works the way you'd expect
 */
export default function ServicePicker({
  selectedServices,
  selectedAddOns,
}: {
  selectedServices: string[];
  selectedAddOns: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function toggle(group: "services" | "add_ons", id: string) {
    const next = new URLSearchParams(params.toString());
    const current = (next.get(group) ?? "").split(",").filter(Boolean);
    const idx = current.indexOf(id);
    if (idx === -1) current.push(id);
    else current.splice(idx, 1);
    if (current.length > 0) next.set(group, current.join(","));
    else next.delete(group);
    // Clear a selected slot whenever services change — duration changes
    // so slots need recomputing.
    next.delete("slot");
    startTransition(() => {
      router.replace(`?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <div className={isPending ? "opacity-60" : ""}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Services
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {SERVICES.map((s) => {
            const on = selectedServices.includes(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => toggle("services", s.id)}
                  className={
                    "rounded-full border px-4 py-2 text-sm transition " +
                    (on
                      ? "border-brand-light bg-brand/20 text-brand-light"
                      : "border-white/15 text-white/80 hover:border-white/40")
                  }
                  aria-pressed={on}
                  title={s.blurb}
                >
                  {s.label}
                  <span className="ml-2 text-[10px] opacity-70">
                    {s.durationMinutes}m
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Add-ons
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {ADD_ONS.map((a) => {
            const on = selectedAddOns.includes(a.id);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => toggle("add_ons", a.id)}
                  className={
                    "rounded-md border px-3 py-1.5 text-xs transition " +
                    (on
                      ? "border-brand-light bg-brand/15 text-brand-light"
                      : "border-white/10 text-white/70 hover:border-white/30")
                  }
                  aria-pressed={on}
                  title={a.blurb}
                >
                  {a.label}
                  {a.durationMinutes > 0 ? (
                    <span className="ml-1.5 opacity-70">
                      +{a.durationMinutes}m
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
