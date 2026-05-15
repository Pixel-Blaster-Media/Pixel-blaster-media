"use client";

import { useActionState } from "react";
import { useState } from "react";

import {
  saveBusinessSettings,
  type BusinessSettingsResult,
} from "./actions";

interface BusinessSettingsFormProps {
  organization: {
    name: string;
    slug: string;
    primary_color: string | null;
    accent_color: string | null;
  };
}

export default function BusinessSettingsForm({
  organization,
}: BusinessSettingsFormProps) {
  const [state, action, pending] = useActionState<
    BusinessSettingsResult,
    FormData
  >(saveBusinessSettings, { ok: false });

  const primaryColor = organization.primary_color ?? "#3f7f5f";
  const accentColor = organization.accent_color ?? "#c9a35b";

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-sm shadow-realtor-text/5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Company
          </p>
          <div className="mt-4 grid gap-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Business name
              </span>
              <input
                name="name"
                defaultValue={organization.name}
                required
                maxLength={80}
                className="mt-1 box-border w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/60 focus:border-realtor-primary/45"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Booking handle
              </span>
              <input
                name="slug"
                defaultValue={organization.slug}
                required
                maxLength={60}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                className="mt-1 box-border w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/60 focus:border-realtor-primary/45"
              />
              <span className="mt-1 block text-xs leading-5 text-realtor-muted">
                Reserved for future company booking pages and branded links.
              </span>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-sm shadow-realtor-text/5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Brand colors
          </p>
          <div className="mt-4 grid gap-4">
            <ColorField
              label="Primary"
              name="primary_color"
              defaultValue={primaryColor}
            />
            <ColorField
              label="Accent"
              name="accent_color"
              defaultValue={accentColor}
            />
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/80 p-5 shadow-sm shadow-realtor-text/5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-realtor-text">
              SaaS readiness
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-realtor-muted">
              These settings belong to this company only. Later, new
              businesses will get their own profile, calendar, catalog, and
              integrations instead of sharing Pixel Blaster settings.
            </p>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-realtor-text/10 transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {pending ? "Saving..." : "Save business profile"}
          </button>
        </div>
        {state.error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Business profile saved.
          </p>
        ) : null}
      </section>
    </form>
  );
}

function ColorField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  const [color, setColor] = useState(defaultValue);

  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
      </span>
      <span className="mt-1 flex items-center gap-2 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2">
        <input
          type="color"
          value={color}
          onChange={(event) => setColor(event.currentTarget.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-realtor-primary/15 bg-transparent p-0"
          aria-label={`${label} color`}
        />
        <input
          name={name}
          value={color}
          onChange={(event) => setColor(event.currentTarget.value)}
          pattern="#[0-9a-fA-F]{6}"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-realtor-text outline-none"
          aria-label={`${label} hex color`}
        />
      </span>
    </label>
  );
}
