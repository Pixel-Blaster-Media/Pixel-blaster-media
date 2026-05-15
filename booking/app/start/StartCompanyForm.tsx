"use client";

import Link from "next/link";
import { useActionState } from "react";

import { startCompanySignup, type StartCompanyResult } from "./actions";

const initialState: StartCompanyResult = { ok: false };

export default function StartCompanyForm() {
  const [state, action, pending] = useActionState(
    startCompanySignup,
    initialState,
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

      <section className="realtor-elevated-panel grid gap-4 rounded-3xl p-5 md:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary">
            Create account
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-realtor-text">
            Start with your login.
          </h2>
          <p className="mt-2 text-sm leading-6 text-realtor-muted">
            We&apos;ll create a private starter workspace for you. Once you are
            inside, you can set your company name, booking link, colors,
            pricing, calendar, and integrations.
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
      </section>

      <section className="realtor-warm-panel rounded-3xl p-5 md:p-6">
        <p className="text-sm font-semibold text-realtor-text">
          Google and Apple sign-in
        </p>
        <p className="mt-2 text-sm leading-6 text-realtor-muted">
          Those can be added next once the Supabase OAuth providers are
          configured. Email/password gets the signup flow working now without
          extra provider setup.
        </p>
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
        <Link href="/auth/sign-in?next=/admin" className="text-realtor-primary underline">
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
}: {
  label: string;
  name: string;
  type?: string;
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
