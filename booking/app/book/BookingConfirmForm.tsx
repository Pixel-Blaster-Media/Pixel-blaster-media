"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";

import { checkEmailAction, createPublicBooking, type BookResult } from "./actions";

const initial: BookResult | null = null;

interface ProfileLite {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  brokerage: string | null;
}

/**
 * Public booking confirm form.
 *
 * Two modes:
 *   - Signed in (profile != null): hidden contact/auth section, just
 *     property details + notes.
 *   - Signed out: collects contact info, then (on email blur) checks
 *     whether that email already has an account. If yes → password +
 *     "Forgot password?" link. If no → "Create a password" helper.
 *
 * One unified submit handler (`createPublicBooking`) handles both
 * signup and sign-in paths based on the detected state.
 */
export default function BookingConfirmForm({
  serviceSlugs,
  addOnSlugs,
  slot,
  whenLabel,
  profile,
}: {
  serviceSlugs: string[];
  addOnSlugs: string[];
  slot: string;
  whenLabel: string;
  profile: ProfileLite | null;
}) {
  const [state, formAction] = useFormState(createPublicBooking, initial);

  const [email, setEmail] = useState(profile?.email ?? "");
  const [mode, setMode] = useState<"unknown" | "new" | "existing">("unknown");
  const [, startTransition] = useTransition();

  // When the user types a fresh email, reset our detection so they
  // see the neutral label until the server check finishes.
  function handleEmailChange(value: string) {
    setEmail(value);
    setMode("unknown");
  }

  async function handleEmailBlur() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setMode("unknown");
      return;
    }
    startTransition(async () => {
      try {
        const exists = await checkEmailAction(trimmed);
        setMode(exists ? "existing" : "new");
      } catch {
        setMode("unknown");
      }
    });
  }

  // Re-seed state on profile change (e.g. client nav into /book while signed in)
  useEffect(() => {
    if (profile) setEmail(profile.email);
  }, [profile]);

  return (
    <form action={formAction} className="space-y-5">
      {serviceSlugs.map((s) => (
        <input key={s} type="hidden" name="services" value={s} />
      ))}
      {addOnSlugs.map((a) => (
        <input key={a} type="hidden" name="add_ons" value={a} />
      ))}
      <input type="hidden" name="slot" value={slot} />

      <p className="text-sm text-ink-muted">
        You&apos;re booking <span className="text-white">{whenLabel}</span>.
      </p>

      {/* ---- Property details (always shown) ---- */}
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Property details</legend>
        <Field
          label="Property address"
          name="street_address"
          required
          placeholder="123 King St W"
          className="md:col-span-2"
          error={state?.errors?.street_address}
        />
        <Field label="City" name="city" defaultValue="Hamilton" />
        <Field label="Postal code" name="postal_code" placeholder="L8P 4S8" />
        <label className="block md:col-span-2">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            Notes (optional)
          </span>
          <textarea
            name="notes"
            rows={3}
            placeholder="Tenant occupied, vacant, pets, gate code, etc."
            className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60"
          />
        </label>
      </fieldset>

      {/* ---- Contact + auth (hidden when signed in) ---- */}
      {profile ? null : (
        <fieldset className="grid gap-4 md:grid-cols-2">
          <legend className="sr-only">Your contact info</legend>

          <Field
            label="Full name"
            name="contact_name"
            required
            autoComplete="name"
            error={state?.errors?.contact_name}
          />
          <Field
            label="Brokerage"
            name="brokerage"
            placeholder="Royal LePage, Re/Max, etc."
            autoComplete="organization"
          />
          <Field
            label="Email"
            name="contact_email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => handleEmailChange(e.currentTarget.value)}
            onBlur={handleEmailBlur}
            error={state?.errors?.contact_email}
          />
          <Field
            label="Phone"
            name="contact_phone"
            type="tel"
            autoComplete="tel"
            placeholder="(905) 555-0123"
            error={state?.errors?.contact_phone}
          />

          <div className="md:col-span-2">
            <label className="block">
              <span className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-ink-muted">
                <span>
                  {mode === "existing"
                    ? "Password"
                    : "Create a password"}
                  <span className="text-brand-light"> *</span>
                </span>
                {mode === "existing" ? (
                  <Link
                    href="/auth/reset"
                    className="text-[11px] normal-case tracking-normal text-brand-light hover:underline"
                  >
                    Forgot password?
                  </Link>
                ) : null}
              </span>
              <input
                name="password"
                type="password"
                required
                autoComplete={
                  mode === "existing" ? "current-password" : "new-password"
                }
                minLength={8}
                className={
                  "mt-1 w-full rounded-md border bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
                  (state?.errors?.password
                    ? "border-red-400/60"
                    : "border-white/10")
                }
              />
              <span className="mt-1 block text-[11px] text-ink-muted">
                {mode === "existing"
                  ? "We found an account for this email. Sign in to complete your booking."
                  : mode === "new"
                    ? "You'll be able to sign in later to see all your bookings and reschedule."
                    : "8+ characters. We'll either sign you in or create your account."}
              </span>
              {state?.errors?.password ? (
                <span className="mt-1 block text-xs text-red-300">
                  {state.errors.password}
                </span>
              ) : null}
            </label>
          </div>
        </fieldset>
      )}

      {state?.errors?._form ? (
        <p role="alert" className="text-sm text-red-300">
          {state.errors._form}
        </p>
      ) : null}

      <SubmitRow />
    </form>
  );
}

function SubmitRow() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-5">
      <p className="text-xs text-ink-muted">
        Payment happens after the shoot. We&apos;ll confirm pricing if anything
        needs adjusting.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-5 py-2.5 font-semibold text-white hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Booking…" : "Confirm booking"}
      </button>
    </div>
  );
}

function Field({
  label,
  name,
  error,
  className = "",
  type = "text",
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
  className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={"block " + className}>
      <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
        {label}
        {rest.required ? <span className="text-brand-light"> *</span> : null}
      </span>
      <input
        name={name}
        type={type}
        {...rest}
        className={
          "mt-1 w-full rounded-md border bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
          (error ? "border-red-400/60" : "border-white/10")
        }
      />
      {error ? (
        <span className="mt-1 block text-xs text-red-300">{error}</span>
      ) : null}
    </label>
  );
}
