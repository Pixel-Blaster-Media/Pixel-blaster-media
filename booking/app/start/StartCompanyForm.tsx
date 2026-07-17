"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import { startCompanySignup, type StartCompanyResult } from "./actions";

const initialState: StartCompanyResult = { ok: false };

export default function StartCompanyForm() {
  const [state, action, pending] = useActionState(
    startCompanySignup,
    initialState,
  );
  const [companyName, setCompanyName] = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#3f7f5f");
  const [accentColor, setAccentColor] = useState("#c9a35b");
  const previewUrl = useMemo(
    () => `/book?org=${companySlug || "your-company"}`,
    [companySlug],
  );

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

      <section className="realtor-elevated-panel grid gap-5 rounded-3xl p-5 md:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary">
            Create your company
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-realtor-text">
            Create your login, then set the brand basics.
          </h2>
          <p className="mt-2 text-sm leading-6 text-realtor-muted">
            Start with the owner account. Then choose the public booking name,
            link, and colors realtors will see.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
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
          <div className="md:col-span-2">
            <Field
              label="Password"
              name="admin_password"
              type="password"
              required
              minLength={10}
              placeholder="At least 10 characters"
              helper="You will use this to sign into your company dashboard."
            />
          </div>
        </div>

        <div className="rounded-2xl border border-realtor-primary/10 bg-realtor-surface-muted/45 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Booking brand
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_0.8fr]">
            <Field
              label="Business name"
              name="company_name"
              required
              placeholder="Forest House Media"
              value={companyName}
              onChange={(value) => {
                setCompanyName(value);
                if (!slugEdited) setCompanySlug(slugify(value));
              }}
              helper="This appears on your booking page and outgoing emails."
            />
            <Field
              label="Booking handle"
              name="company_slug"
              required
              placeholder="forest-house-media"
              value={companySlug}
              onChange={(value) => {
                setSlugEdited(true);
                setCompanySlug(slugify(value));
              }}
              helper={`${previewUrl} — spaces automatically become hyphens.`}
            />
          </div>
        </div>

        <div className="grid gap-4 rounded-2xl border border-realtor-primary/10 bg-realtor-surface-muted/45 p-4 md:grid-cols-[1fr_1fr_1.1fr]">
          <ColorField
            label="Button color"
            name="primary_color"
            color={primaryColor}
            setColor={setPrimaryColor}
          />
          <ColorField
            label="Accent color"
            name="accent_color"
            color={accentColor}
            setColor={setAccentColor}
          />
          <div
            className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface p-3"
            style={
              {
                "--preview-primary": primaryColor,
                "--preview-accent": accentColor,
              } as CSSProperties
            }
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
              Preview
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-10 w-10 rounded-xl bg-[var(--preview-primary)]" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-realtor-text">
                  {companyName || "Your company"}
                </p>
                <p className="truncate text-xs text-realtor-muted">
                  {previewUrl}
                </p>
              </div>
            </div>
            <span className="mt-3 inline-flex rounded-full bg-[var(--preview-primary)] px-4 py-2 text-xs font-semibold text-white">
              Continue booking
            </span>
          </div>
        </div>
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
        {pending ? "Creating account..." : "Create account"}
      </button>

      <p className="text-center text-sm text-realtor-muted">
        Already have an account?{" "}
        <Link href="/auth/sign-in?audience=company&next=/admin" className="text-realtor-primary underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  minLength,
  placeholder,
  helper,
  value,
  onChange,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  helper?: string;
  value?: string;
  onChange?: (value: string) => void;
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
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        value={value}
        onChange={
          onChange
            ? (event) => onChange(event.currentTarget.value)
            : undefined
        }
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
  color,
  setColor,
}: {
  label: string;
  name: string;
  color: string;
  setColor: (color: string) => void;
}) {
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
          aria-label={label}
        />
        <input
          name={name}
          value={color}
          onChange={(event) => setColor(event.currentTarget.value)}
          pattern="#[0-9a-fA-F]{6}"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-realtor-text outline-none"
          aria-label={`${label} hex code`}
        />
      </span>
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
