"use client";

import { useActionState, useState } from "react";

import { createCompany, type CreateCompanyResult } from "./actions";

const initialState: CreateCompanyResult = { ok: false };

export default function CreateCompanyForm() {
  const [state, action, pending] = useActionState(createCompany, initialState);
  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#3f7f5f");
  const [accentColor, setAccentColor] = useState("#c9a35b");

  const bookingSlug = slug || slugify(companyName);
  const bookingUrl = bookingSlug
    ? `/book?org=${bookingSlug}`
    : "/book?org=company-handle";

  function handleCompanyName(value: string) {
    setCompanyName(value);
    if (!slug) setSlug(slugify(value));
  }

  return (
    <form action={action} className="space-y-5">
      <section className="grid gap-4 rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-sm shadow-realtor-text/5 md:grid-cols-2">
        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Company
          </p>
          <p className="mt-2 text-sm leading-6 text-realtor-muted">
            This creates the tenant shell: company profile, booking handle,
            starter availability, and an optional copy of the current catalog.
          </p>
        </div>

        <Field
          label="Company name"
          name="company_name"
          value={companyName}
          onChange={handleCompanyName}
          required
          placeholder="Forest House Media"
        />
        <Field
          label="Booking handle"
          name="slug"
          value={slug}
          onChange={(value) => setSlug(slugify(value))}
          required
          placeholder="forest-house-media"
          helper={`Public link: ${bookingUrl}`}
        />

        <ColorField
          label="Primary color"
          name="primary_color"
          value={primaryColor}
          onChange={setPrimaryColor}
        />
        <ColorField
          label="Accent color"
          name="accent_color"
          value={accentColor}
          onChange={setAccentColor}
        />
      </section>

      <section className="grid gap-4 rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-sm shadow-realtor-text/5 md:grid-cols-2">
        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            First admin
          </p>
          <p className="mt-2 text-sm leading-6 text-realtor-muted">
            Use the owner/operator&apos;s real email. We will send stable sign-in
            instructions for their private setup checklist.
          </p>
        </div>

        <Field
          label="Admin name"
          name="admin_name"
          required
          placeholder="Alex Morgan"
        />
        <Field
          label="Admin email"
          name="admin_email"
          type="email"
          required
          placeholder="alex@example.com"
        />

        <label className="flex items-start gap-3 rounded-2xl border border-realtor-primary/15 bg-realtor-soft/35 p-4">
          <input
            type="checkbox"
            name="copy_catalog"
            defaultChecked
            className="mt-1 h-4 w-4 rounded border-realtor-primary/25 text-realtor-primary focus:ring-realtor-primary/35"
          />
          <span>
            <span className="block text-sm font-semibold text-realtor-text">
              Copy Pixel&apos;s current catalog
            </span>
            <span className="mt-1 block text-xs leading-5 text-realtor-muted">
              Best starter option. The new company can edit pricing, duration,
              add-ons, and square-footage rules after setup.
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-sm shadow-realtor-text/5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-realtor-text">
              Create company
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-realtor-muted">
              Calendar, iGUIDE, QuickBooks, AI, and email credentials are
              intentionally not copied. Each business connects its own accounts
              from Integrations.
            </p>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-realtor-text/10 transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {pending ? "Creating..." : "Create company and send invitation"}
          </button>
        </div>

        {state.error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
            <p className="font-semibold">
              {state.invitationSent
                ? `${state.companyName} is ready and the owner invitation was sent.`
                : `${state.companyName} is ready, but invitation delivery was not confirmed.`}
            </p>
            {state.warning ? (
              <p className="mt-1 font-medium">{state.warning}</p>
            ) : null}
            <p className="mt-1">
              Admin: {state.adminEmail} · Booking link:{" "}
              <code className="rounded bg-white/70 px-1.5 py-0.5">
                {state.bookingPath}
              </code>
            </p>
          </div>
        ) : null}
      </section>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
  required,
  minLength,
  placeholder,
  helper,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  helper?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
        {required ? <span className="text-realtor-primary"> *</span> : null}
      </span>
      <input
        name={name}
        type={type}
        value={value}
        onChange={
          onChange ? (event) => onChange(event.currentTarget.value) : undefined
        }
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        className="mt-1 box-border w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2.5 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/50 focus:border-realtor-primary/45"
      />
      {helper ? (
        <span className="mt-1 block text-xs leading-5 text-realtor-muted">
          {helper}
        </span>
      ) : null}
    </label>
  );
}

function ColorField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
      </span>
      <span className="mt-1 flex items-center gap-2 rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-realtor-primary/15 bg-transparent p-0"
          aria-label={label}
        />
        <input
          name={name}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          pattern="#[0-9a-fA-F]{6}"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-realtor-text outline-none"
        />
      </span>
    </label>
  );
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
