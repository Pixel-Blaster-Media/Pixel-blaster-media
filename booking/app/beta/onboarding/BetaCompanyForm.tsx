"use client";

import { useActionState, useState } from "react";

import {
  acceptBetaCompanyInvite,
  type BetaCompanySetupResult,
} from "./actions";

const initialState: BetaCompanySetupResult = { ok: false };

export default function BetaCompanyForm({
  email,
  expiresAt,
}: {
  email: string;
  expiresAt: string;
}) {
  const [state, action, pending] = useActionState(
    acceptBetaCompanyInvite,
    initialState,
  );
  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");

  if (state.ok) {
    return (
      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-7 text-emerald-950 shadow-xl shadow-realtor-text/10">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
          Company created
        </p>
        <h2 className="mt-3 text-2xl font-semibold">{state.companyName} is ready</h2>
        <p className="mt-3 text-sm leading-6">
          Check <strong>{email}</strong> for the secure owner sign-in link. Your
          company data and future integration credentials are isolated from every
          other business on the platform.
        </p>
        {state.bookingPath ? (
          <p className="mt-3 text-sm">
            Booking page: <code className="rounded bg-white/70 px-2 py-1">{state.bookingPath}</code>
          </p>
        ) : null}
        {state.warning ? <p className="mt-3 text-sm font-medium">{state.warning}</p> : null}
      </section>
    );
  }

  function updateCompanyName(value: string) {
    setCompanyName(value);
    if (!slug) setSlug(slugify(value));
  }

  return (
    <form
      action={action}
      className="space-y-5 rounded-3xl border border-realtor-primary/15 bg-realtor-surface p-5 shadow-xl shadow-realtor-text/10 sm:p-7"
    >
      <section className="rounded-2xl bg-realtor-soft/35 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
          Invitation email
        </p>
        <p className="mt-1 text-sm font-semibold text-realtor-text">{email}</p>
        <p className="mt-1 text-xs text-realtor-muted">
          This link is locked to that address and expires {new Date(expiresAt).toLocaleDateString()}.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Company name"
          name="company_name"
          value={companyName}
          onChange={updateCompanyName}
          placeholder="Forest House Media"
          required
        />
        <Field
          label="Booking handle"
          name="slug"
          value={slug}
          onChange={(value) => setSlug(slugify(value))}
          placeholder="forest-house-media"
          helper={`Your link: /book?org=${slug || "company-handle"}`}
          required
        />
        <Field
          label="Your name"
          name="admin_name"
          placeholder="Alex Morgan"
          autoComplete="name"
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Primary" name="primary_color" defaultValue="#3f7f5f" />
          <ColorField label="Accent" name="accent_color" defaultValue="#c9a35b" />
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-2xl border border-realtor-primary/15 bg-realtor-soft/25 p-4">
        <input
          type="checkbox"
          name="copy_catalog"
          defaultChecked
          className="mt-1 h-4 w-4 rounded border-realtor-primary/25 text-realtor-primary"
        />
        <span>
          <span className="block text-sm font-semibold text-realtor-text">
            Start with a sample real-estate media catalogue
          </span>
          <span className="mt-1 block text-xs leading-5 text-realtor-muted">
            Copies service names, prices, and durations only. Customer records,
            bookings, passwords, Calendar, QuickBooks, email, and other credentials
            are never copied.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-realtor-primary/10 pt-5">
        <p className="max-w-xl text-xs leading-5 text-realtor-muted">
          After setup, we send a separate secure sign-in email. No password is
          collected on this public page.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {pending ? "Creating company..." : "Create my company"}
        </button>
      </div>

      {state.error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  placeholder,
  helper,
  autoComplete,
  required,
}: {
  label: string;
  name: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  helper?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
      </span>
      <input
        name={name}
        value={value}
        onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        maxLength={80}
        className="mt-1 box-border w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2.5 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/50 focus:border-realtor-primary/45"
      />
      {helper ? <span className="mt-1 block text-xs text-realtor-muted">{helper}</span> : null}
    </label>
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
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
      </span>
      <input
        type="color"
        name={name}
        defaultValue={defaultValue}
        className="mt-1 h-11 w-full cursor-pointer rounded-xl border border-realtor-primary/15 bg-realtor-surface p-1"
      />
    </label>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
