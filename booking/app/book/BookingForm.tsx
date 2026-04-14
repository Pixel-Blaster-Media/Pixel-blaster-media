"use client";

import { useFormState, useFormStatus } from "react-dom";

import {
  ADD_ONS,
  PREFERRED_TIMES,
  SERVICES,
} from "@/lib/booking/services";
import type {
  BookingActionResult,
  ValidationErrors,
} from "@/lib/booking/schema";
import { submitBookingRequest } from "./actions";

const initialState: BookingActionResult | null = null;

export default function BookingForm() {
  const [state, formAction] = useFormState(submitBookingRequest, initialState);
  const errors: ValidationErrors = state?.errors ?? {};

  return (
    <form action={formAction} className="space-y-10">
      {errors._form ? (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
        >
          {errors._form}
        </div>
      ) : null}

      {/* Honeypot — invisible to humans, irresistible to bots */}
      <input
        type="text"
        name="_company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <Section
        eyebrow="Step 1"
        title="What do you need?"
        helper="Pick everything you'd like for this listing. We'll quote based on what you select."
        error={errors.services}
      >
        <ul className="grid gap-3 md:grid-cols-2">
          {SERVICES.map((s) => (
            <li key={s.id}>
              <label className="flex h-full cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-ink-soft/50 p-4 transition hover:border-brand/60 hover:bg-ink-soft has-[:checked]:border-brand-light has-[:checked]:bg-brand/10">
                <input
                  type="checkbox"
                  name="services"
                  value={s.id}
                  className="mt-1 h-4 w-4 accent-brand-light"
                />
                <span className="flex-1">
                  <span className="block font-semibold text-white">
                    {s.label}
                  </span>
                  <span className="mt-1 block text-sm text-ink-muted">
                    {s.blurb}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <fieldset className="mt-6">
          <legend className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
            Add-ons
          </legend>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {ADD_ONS.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-white/5 bg-ink-soft/40 p-3 text-sm hover:border-brand/40 has-[:checked]:border-brand-light/60"
              >
                <input
                  type="checkbox"
                  name="add_ons"
                  value={a.id}
                  className="mt-0.5 h-4 w-4 accent-brand-light"
                />
                <span className="flex-1">
                  <span className="block text-white">{a.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {a.blurb}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      <Section
        eyebrow="Step 2"
        title="The property"
        helper="Where are we shooting? Even an approximate address is fine."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Street address"
            name="street_address"
            required
            error={errors.street_address}
            className="md:col-span-2"
            placeholder="123 King St W"
          />
          <Field label="City" name="city" defaultValue="Hamilton" />
          <Field label="Postal code" name="postal_code" placeholder="L8P 4S8" />
          <Field
            label="Approx. square footage"
            name="square_footage"
            inputMode="numeric"
            type="number"
            min={0}
            error={errors.square_footage}
          />
        </div>
      </Section>

      <Section
        eyebrow="Step 3"
        title="When works for you?"
        helper="Pick a preferred date and time window. We'll confirm or suggest the closest available slot."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Preferred date"
            name="preferred_date"
            type="date"
            error={errors.preferred_date}
          />
          <SelectField
            label="Preferred time"
            name="preferred_time"
            error={errors.preferred_time}
            options={[
              { value: "", label: "No preference" },
              ...PREFERRED_TIMES.map((p) => ({
                value: p.id,
                label: p.label,
              })),
            ]}
          />
          <TextareaField
            label="Anything we should know?"
            name="notes"
            placeholder="Tenant occupied, vacant, pets, gate code, etc."
            className="md:col-span-2"
            rows={3}
          />
        </div>
      </Section>

      <Section
        eyebrow="Step 4"
        title="Your contact"
        helper="We'll send the confirmation here and reach out about scheduling."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Full name"
            name="contact_name"
            required
            error={errors.contact_name}
            autoComplete="name"
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
            error={errors.contact_email}
            autoComplete="email"
          />
          <Field
            label="Phone"
            name="contact_phone"
            type="tel"
            autoComplete="tel"
            placeholder="(905) 555-0123"
          />
        </div>
      </Section>

      <SubmitRow />
    </form>
  );
}

function SubmitRow() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-6">
      <p className="text-xs text-ink-muted">
        No payment is taken at booking. We'll confirm pricing before the shoot.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-5 py-3 font-semibold text-white transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending…" : "Request booking"}
      </button>
    </div>
  );
}

// ---- Layout helpers ----

function Section({
  eyebrow,
  title,
  helper,
  error,
  children,
}: {
  eyebrow: string;
  title: string;
  helper?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-4">
        <p className="text-[11px] uppercase tracking-[0.2em] text-brand-light">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
        {helper ? (
          <p className="mt-1 text-sm text-ink-muted">{helper}</p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm text-red-300">{error}</p>
        ) : null}
      </header>
      {children}
    </section>
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

function TextareaField({
  label,
  name,
  className = "",
  ...rest
}: {
  label: string;
  name: string;
  className?: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className={"block " + className}>
      <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <textarea
        name={name}
        {...rest}
        className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
  error,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  error?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <select
        name={name}
        className={
          "mt-1 w-full rounded-md border bg-ink-soft px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
          (error ? "border-red-400/60" : "border-white/10")
        }
        defaultValue=""
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="mt-1 block text-xs text-red-300">{error}</span>
      ) : null}
    </label>
  );
}
