"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { createPublicBooking, type BookResult } from "../actions";
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
 * property details, slot), plus a neutral account section. The browser is
 * deliberately not told whether an email already exists.
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
              Your details
            </p>
            <p className="mt-1 text-xs text-realtor-muted">
              Use your existing portal password, or choose one now if this is
              your first booking.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Phone"
              name="contact_phone"
              type="tel"
              required
              autoComplete="tel"
              placeholder="(905) 555-0123"
              value={phone}
              onChange={(e) => setPhone(e.currentTarget.value)}
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
              onChange={(e) => setEmail(e.currentTarget.value)}
              error={formState?.errors?.contact_email}
            />
            <div className="md:col-span-2">
              <label className="block">
                <span className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-realtor-muted">
                  <span>
                    Password<span className="text-realtor-primary"> *</span>
                  </span>
                  <Link
                    href="/auth/reset"
                    className="text-[11px] normal-case tracking-normal text-realtor-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </span>
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  minLength={8}
                  className={
                    "realtor-field mt-1 w-full rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-realtor-primary/35 " +
                    (formState?.errors?.password
                      ? "border-red-600"
                      : "border-realtor-primary/15")
                  }
                />
                <span className="mt-1 block text-[11px] text-realtor-muted">
                  At least 8 characters. If the email is new, this creates your
                  portal. If it already exists, this signs you in securely.
                </span>
                {formState?.errors?.password ? (
                  <span className="mt-1 block text-xs text-red-700">
                    {formState.errors.password}
                  </span>
                ) : null}
              </label>
              <div className="mt-3 rounded-2xl border border-realtor-primary/15 bg-realtor-primary/5 p-3 text-xs text-realtor-muted">
                Your portal keeps this booking, delivered media, invoices, and
                future shoots together.
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
          className="realtor-field mt-1 w-full rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-realtor-primary/35"
        />
      </label>

      {formState?.errors?._form ? (
        <p role="alert" className="text-sm font-medium text-red-700">
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
        className={
          "realtor-field mt-1 w-full rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-realtor-primary/35 " +
          (error ? "border-red-400/60" : "border-realtor-primary/15")
        }
      />
      {error ? (
        <span className="mt-1 block text-xs text-red-700">{error}</span>
      ) : null}
    </label>
  );
}

function buildQuery(state: WizardState): string {
  return serializeWizardState(state).toString();
}
