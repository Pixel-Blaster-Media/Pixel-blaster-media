"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import {
  checkEmailAction,
  createPublicBooking,
  lookupRealtorByPhoneAction,
  type BookResult,
} from "../actions";
import {
  serializeWizardState,
  type WizardState,
} from "@/lib/booking/wizard-state";
import BookingTotalBar, {
  type BookingTotalItem,
} from "../_components/BookingTotalBar";

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
  items,
}: {
  state: WizardState;
  profile: ProfileLite | null;
  items: BookingTotalItem[];
}) {
  const [formState, formAction] = useActionState(createPublicBooking, initial);

  const [contactName, setContactName] = useState(profile?.fullName ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [brokerage, setBrokerage] = useState(profile?.brokerage ?? "");
  const [returningName, setReturningName] = useState<string | null>(null);
  const [mode, setMode] = useState<"unknown" | "new" | "existing">("unknown");
  const [, startTransition] = useTransition();
  const [lookupPending, startLookupTransition] = useTransition();

  function handlePhoneChange(value: string) {
    setPhone(value);
    setReturningName(null);
  }

  async function handlePhoneBlur() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return;

    startLookupTransition(async () => {
      try {
        const match = await lookupRealtorByPhoneAction(
          state.organizationSlug ?? null,
          phone,
        );
        if (!match.found || !match.fullName) return;

        setReturningName(firstName(match.fullName));
        setContactName(match.fullName);
      } catch {
        // Keep the normal first-time form if recognition is unavailable.
      }
    });
  }

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
    if (!profile) return;
    setContactName(profile.fullName ?? "");
    setEmail(profile.email);
    setPhone(profile.phone ?? "");
    setBrokerage(profile.brokerage ?? "");
  }, [profile]);

  return (
    <form action={formAction} className="space-y-5">
      {/* Carry wizard state into the action */}
      {state.organizationSlug ? (
        <input type="hidden" name="org" value={state.organizationSlug} />
      ) : null}
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
              {returningName ? `Welcome back, ${returningName}` : "Your details"}
            </p>
            <p className="mt-1 text-xs text-realtor-muted">
              {returningName
                ? "We found your profile and filled in the details we already have. You can confirm this booking without signing into the portal."
                : "Start with your phone number. If you have booked with us before, we will fill in the rest."}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Phone"
              name="contact_phone"
              type="tel"
              autoComplete="tel"
              placeholder="(905) 555-0123"
              value={phone}
              onChange={(e) => handlePhoneChange(e.currentTarget.value)}
              onBlur={handlePhoneBlur}
              helper={
                lookupPending
                  ? "Checking for your profile..."
                  : returningName
                    ? "Profile matched by phone."
                    : undefined
              }
              error={formState?.errors?.contact_phone}
            />
            <Field
              label="Full name"
              name="contact_name"
              required
              autoComplete="name"
              value={contactName}
              onChange={(e) => setContactName(e.currentTarget.value)}
              error={formState?.errors?.contact_name}
            />
            <Field
              label="Brokerage"
              name="brokerage"
              placeholder="Royal LePage, Re/Max, etc."
              autoComplete="organization"
              value={brokerage}
              onChange={(e) => setBrokerage(e.currentTarget.value)}
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
            {returningName ? (
              <div className="md:col-span-2 rounded-2xl border border-brand-light/25 bg-brand-light/10 p-3 text-xs text-realtor-muted">
                <p className="font-semibold text-realtor-text">
                  Fast booking enabled
                </p>
                <p className="mt-1">
                  No password needed right now. We will attach this booking to
                  your existing profile, email the confirmation, and you can sign
                  into the portal later only when you need media, invoices, or
                  booking history.
                </p>
              </div>
            ) : (
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
                  <span className="font-semibold text-realtor-text">Sign in</span>{" "}
                  using this email and password. No magic link required.
                </div>
              </div>
            )}
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

      <div className="flex flex-wrap items-center justify-start gap-3 border-t border-realtor-primary/10 pt-5">
        <Link
          href={`/book/schedule?${buildQuery(state)}`}
          className="rounded-full border border-realtor-primary/20 px-4 py-2 text-sm text-realtor-muted transition hover:border-realtor-primary/35 hover:bg-realtor-surface"
        >
          ← Back
        </Link>
      </div>

      <SubmitTotalBar
        items={items}
        selectedSlugs={state.services}
        selectedAddOnSlugs={state.addOns}
        squareFootage={state.squareFootage}
      />
    </form>
  );
}

function SubmitTotalBar({
  items,
  selectedSlugs,
  selectedAddOnSlugs,
  squareFootage,
}: {
  items: BookingTotalItem[];
  selectedSlugs: string[];
  selectedAddOnSlugs: string[];
  squareFootage: number | null;
}) {
  const { pending } = useFormStatus();
  return (
    <BookingTotalBar
      items={items}
      selectedSlugs={selectedSlugs}
      selectedAddOnSlugs={selectedAddOnSlugs}
      squareFootage={squareFootage}
      submit
      disabled={pending}
      ctaLabel={pending ? "Booking..." : "Confirm booking"}
      sticky={false}
    />
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
  helper,
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
  helper?: string;
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
      {helper ? (
        <span className="mt-1 block text-[11px] text-realtor-muted">
          {helper}
        </span>
      ) : null}
      {error ? (
        <span className="mt-1 block text-xs text-red-300">{error}</span>
      ) : null}
    </label>
  );
}

function firstName(nameOrEmail: string): string {
  const local = nameOrEmail.includes("@")
    ? nameOrEmail.split("@")[0]?.replace(/[._-]+/g, " ")
    : nameOrEmail;
  const first = local?.trim().split(/\s+/)[0];
  return first || "there";
}

function buildQuery(state: WizardState): string {
  return serializeWizardState(state).toString();
}
