"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";

import { checkEmailAction, createPublicBooking, type BookResult } from "../actions";
import type { WizardState } from "@/lib/booking/wizard-state";

const initial: BookResult | null = null;

interface ProfileLite {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  brokerage: string | null;
}

/**
 * Step 4 form — hidden inputs carry forward the wizard state (services,
 * property details, slot), plus the auth section that toggles between
 * sign-in and create-account based on email existence.
 */
export default function ConfirmForm({
  state,
  profile,
}: {
  state: WizardState;
  profile: ProfileLite | null;
}) {
  const [formState, formAction] = useFormState(createPublicBooking, initial);

  const [email, setEmail] = useState(profile?.email ?? "");
  const [mode, setMode] = useState<"unknown" | "new" | "existing">("unknown");
  const [, startTransition] = useTransition();

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

  useEffect(() => {
    if (profile) setEmail(profile.email);
  }, [profile]);

  return (
    <form action={formAction} className="space-y-5">
      {/* Carry wizard state into the action */}
      {state.services.map((s) => (
        <input key={s} type="hidden" name="services" value={s} />
      ))}
      {state.addOns.map((a) => (
        <input key={a} type="hidden" name="add_ons" value={a} />
      ))}
      <input type="hidden" name="slot" value={state.slot ?? ""} />
      <input type="hidden" name="street_address" value={state.streetAddress} />
      <input type="hidden" name="unit_number" value={state.unitNumber} />
      <input type="hidden" name="city" value={state.city} />
      <input type="hidden" name="postal_code" value={state.postalCode} />
      <input
        type="hidden"
        name="square_footage"
        value={state.squareFootage == null ? "" : String(state.squareFootage)}
      />
      <input type="hidden" name="is_vacant" value={state.isVacant ?? ""} />
      <input
        type="hidden"
        name="include_basement"
        value={
          state.includeBasement == null ? "" : state.includeBasement ? "1" : "0"
        }
      />
      {state.shotRequests.map((s) => (
        <input key={s} type="hidden" name="must_have_shots" value={s} />
      ))}
      <input type="hidden" name="shoot_notes" value={state.shootNotes} />

      {profile ? null : (
        <fieldset className="realtor-warm-panel rounded-3xl p-4 md:p-5">
          <legend className="sr-only">Your contact info</legend>
          <div className="mb-4">
            <p className="text-sm font-semibold text-realtor-text">
              Your portal login
            </p>
            <p className="mt-1 text-xs text-realtor-muted">
              We use this to confirm the booking and create your private media
              portal. Use an email you can access later.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Full name"
              name="contact_name"
              required
              autoComplete="name"
              error={formState?.errors?.contact_name}
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
              error={formState?.errors?.contact_email}
            />
            <Field
              label="Phone"
              name="contact_phone"
              type="tel"
              autoComplete="tel"
              placeholder="(905) 555-0123"
              error={formState?.errors?.contact_phone}
            />
            <div className="md:col-span-2">
              <label className="block">
                <span className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-realtor-muted">
                  <span>
                    {mode === "existing" ? "Password" : "Create a password"}
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
                    "realtor-field mt-1 w-full rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
                    (formState?.errors?.password
                      ? "border-red-400/60"
                      : "border-realtor-primary/15")
                  }
                />
                <span className="mt-1 block text-[11px] text-realtor-muted">
                  {mode === "existing"
                    ? "We found your account. Enter your password to finish this booking."
                    : mode === "new"
                      ? "Save this password. You'll use it to return for photos, tours, invoices, and future bookings."
                      : "8+ characters. If this email is new, we'll create your portal account. If it exists, we'll sign you in."}
                </span>
                {formState?.errors?.password ? (
                  <span className="mt-1 block text-xs text-red-300">
                    {formState.errors.password}
                  </span>
                ) : null}
              </label>
              <div className="mt-3 rounded-2xl border border-realtor-primary/15 bg-realtor-primary/10 p-3 text-xs text-realtor-muted">
                After you confirm, you can always come back through{" "}
                <span className="font-semibold text-realtor-text">Sign in</span> using
                this email and password. No magic link required.
              </div>
            </div>
          </div>
        </fieldset>
      )}

      {/* Optional notes — for either path. */}
      <label className="realtor-elevated-panel block rounded-3xl p-4 md:p-5">
        <span className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
          Anything we should know? (optional)
        </span>
        <textarea
          name="notes"
          rows={3}
          placeholder="Pets, gate code, lockbox, etc."
          className="realtor-field mt-1 w-full rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-light/60"
        />
      </label>

      {formState?.errors?._form ? (
        <p role="alert" className="text-sm text-red-300">
          {formState.errors._form}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-realtor-primary/10 pt-5">
        <Link
          href={`/book/schedule?${buildQuery(state)}`}
          className="rounded-full border border-realtor-primary/20 px-4 py-2 text-sm text-realtor-muted transition hover:border-realtor-primary/35 hover:bg-realtor-surface"
        >
          ← Back
        </Link>
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-realtor-primary/20 transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Booking…" : "Confirm booking"}
    </button>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  autoComplete,
  value,
  onChange,
  onBlur,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
        {label}
        {required ? <span className="text-brand-light"> *</span> : null}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        className={
          "realtor-field mt-1 w-full rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
          (error ? "border-red-400/60" : "border-realtor-primary/15")
        }
      />
      {error ? (
        <span className="mt-1 block text-xs text-red-300">{error}</span>
      ) : null}
    </label>
  );
}

function buildQuery(state: WizardState): string {
  const out = new URLSearchParams();
  if (state.services.length) out.set("services", state.services.join(","));
  if (state.addOns.length) out.set("add_ons", state.addOns.join(","));
  if (state.streetAddress) out.set("address", state.streetAddress);
  if (state.unitNumber) out.set("unit", state.unitNumber);
  if (state.city) out.set("city", state.city);
  if (state.postalCode) out.set("postal", state.postalCode);
  if (state.squareFootage != null)
    out.set("sqft", String(state.squareFootage));
  if (state.isVacant) out.set("vacant", state.isVacant);
  if (state.includeBasement != null) {
    out.set("basement", state.includeBasement ? "1" : "0");
  }
  if (state.slot) out.set("slot", state.slot);
  return out.toString();
}
