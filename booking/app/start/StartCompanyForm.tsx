"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { startCompanySignup, type StartCompanyResult } from "./actions";

const initialState: StartCompanyResult = { ok: false };

export default function StartCompanyForm() {
  const [state, action, pending] = useActionState(
    startCompanySignup,
    initialState,
  );
  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");

  const bookingSlug = slug || slugify(companyName);
  const bookingUrl = bookingSlug
    ? `/book?org=${bookingSlug}`
    : "/book?org=your-company";

  function handleCompanyName(value: string) {
    setCompanyName(value);
    if (!slug) setSlug(slugify(value));
  }

  if (state.ok) {
    return (
      <section className="realtor-elevated-panel rounded-3xl p-5 md:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary">
          Company created
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-realtor-text">
          {state.companyName} is ready.
        </h2>
        <div className="mt-4 grid gap-3 text-sm text-realtor-muted">
          <p>
            Admin login:{" "}
            <span className="font-semibold text-realtor-text">
              {state.adminEmail}
            </span>
          </p>
          <p>
            Booking link:{" "}
            <code className="rounded-md bg-realtor-surface-muted px-1.5 py-0.5 text-realtor-text">
              {state.bookingPath}
            </code>
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/auth/sign-in?next=/admin"
            className="rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-realtor-primary/90"
          >
            Sign in to admin
          </Link>
          {state.bookingPath ? (
            <Link
              href={state.bookingPath}
              className="rounded-full border border-realtor-primary/20 px-5 py-2.5 text-sm font-semibold text-realtor-primary transition hover:bg-realtor-primary/10"
            >
              View booking page
            </Link>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />

      <section className="realtor-warm-panel grid gap-4 rounded-3xl p-5 md:grid-cols-2 md:p-6">
        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary">
            Business
          </p>
          <p className="mt-2 text-sm leading-6 text-realtor-muted">
            Your booking handle becomes the company&apos;s public booking link.
            Pricing starts as a copy of Pixel&apos;s catalog so you can edit
            from a working setup.
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
      </section>

      <section className="realtor-green-panel grid gap-4 rounded-3xl p-5 md:grid-cols-2 md:p-6">
        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary">
            Owner admin
          </p>
          <p className="mt-2 text-sm leading-6 text-realtor-muted">
            This creates the first admin account for the company. That admin can
            manage pricing, realtors, bookings, calendar, and integrations.
          </p>
        </div>
        <Field
          label="Your name"
          name="admin_name"
          required
          placeholder="Alex Morgan"
        />
        <Field
          label="Email"
          name="admin_email"
          type="email"
          required
          placeholder="alex@example.com"
        />
        <Field
          label="Password"
          name="admin_password"
          type="password"
          required
          minLength={10}
          placeholder="At least 10 characters"
          helper="Use this password to sign into your new admin area."
        />
      </section>

      {state.error ? (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-realtor-primary px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-realtor-text/10 transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {pending ? "Creating your company..." : "Create my booking system"}
      </button>
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

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
