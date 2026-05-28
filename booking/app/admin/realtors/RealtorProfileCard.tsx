"use client";

import { useState, useTransition } from "react";

import type { RealtorAIMemory } from "@/lib/realtors/memory";

import { updateRealtorProfile } from "./actions";

export interface RealtorProfileView {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  alternate_phones: string[];
  brokerage: string | null;
  profile_photo_url: string | null;
  brokerage_logo_url: string | null;
  website_url: string | null;
  instagram_url: string | null;
  delivery_cc_emails: string[];
  internal_notes: string | null;
  ai_memory: RealtorAIMemory;
  created_at: string;
  bookingCount: number;
  activeBookingCount: number;
  deliveredBookingCount: number;
  latestBooking: {
    id: string;
    address: string;
    scheduled_at: string | null;
    status: string;
  } | null;
}

export default function RealtorProfileCard({
  realtor,
}: {
  realtor: RealtorProfileView;
}) {
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  return (
    <article className="realtor-elevated-panel overflow-hidden rounded-3xl">
      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,320px)_auto] md:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <ProfileImage realtor={realtor} />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-realtor-text">
              {realtor.full_name || realtor.email}
            </h2>
            <p className="truncate text-sm text-realtor-muted">{realtor.email}</p>
            {realtor.internal_notes ? (
              <p className="mt-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                Memory saved
              </p>
            ) : null}
            {hasStructuredMemory(realtor.ai_memory) ? (
              <p className="mt-1 ml-1 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                Smart memory
              </p>
            ) : null}
            {realtor.brokerage ? (
              <p className="mt-1 truncate text-xs font-medium text-realtor-primary">
                {realtor.brokerage}
              </p>
            ) : (
              <p className="mt-1 text-xs text-amber-700">Brokerage missing</p>
            )}
          </div>
        </div>

        <div className="md:w-72 md:shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
            Latest shoot
          </p>
          {realtor.latestBooking ? (
            <a
              href={`/admin/bookings/${realtor.latestBooking.id}`}
              className="mt-1 block rounded-2xl border border-realtor-primary/15 bg-white/70 px-3 py-2 text-sm text-realtor-text transition hover:border-realtor-primary/35 hover:bg-white"
            >
              <span className="block truncate font-semibold">
                {realtor.latestBooking.address}
              </span>
              <span className="mt-0.5 block text-xs text-realtor-muted">
                {realtor.latestBooking.scheduled_at
                  ? new Date(realtor.latestBooking.scheduled_at).toLocaleDateString()
                  : "No date"}{" "}
                · {realtor.latestBooking.status}
              </span>
            </a>
          ) : (
            <p className="mt-1 rounded-2xl border border-dashed border-realtor-primary/15 px-3 py-2 text-sm">
              No shoots yet.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setIsOpen((current) => !current);
            setMessage(null);
          }}
          aria-expanded={isOpen}
          className={
            "w-full rounded-full px-4 py-2 text-sm font-semibold transition md:w-auto " +
            (isOpen
              ? "border border-realtor-primary/20 bg-white text-realtor-primary hover:bg-realtor-primary/5"
              : "bg-realtor-primary text-white hover:bg-realtor-primary/90")
          }
        >
          {isOpen ? "Close" : "Edit profile"}
        </button>
      </div>

      {isOpen ? (
        <div className="border-t border-realtor-primary/10 bg-white/55">
          <form
            action={(formData) => {
              setMessage(null);
              startTransition(async () => {
                const result = await updateRealtorProfile(formData);
                setMessage(
                  result.ok
                    ? { kind: "ok", text: "Profile saved." }
                    : {
                        kind: "err",
                        text: result.error ?? "Could not save profile.",
                      },
                );
              });
            }}
            className="space-y-4 px-4 pb-4"
          >
            <input type="hidden" name="profile_id" value={realtor.id} />

            <section className="pt-3">
              <div className="grid gap-2 text-xs text-realtor-muted sm:grid-cols-3">
                <Stat label="Total shoots" value={String(realtor.bookingCount)} />
                <Stat label="Active" value={String(realtor.activeBookingCount)} />
                <Stat
                  label="Delivered"
                  value={String(realtor.deliveredBookingCount)}
                />
              </div>
            </section>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Full name">
                <input
                  name="full_name"
                  defaultValue={realtor.full_name ?? ""}
                  className="admin-input"
                  placeholder="Agent name"
                />
              </Field>
              <Field label="Email">
                <input
                  value={realtor.email}
                  readOnly
                  className="admin-input cursor-not-allowed bg-realtor-primary/5 text-realtor-muted"
                  title="Email is controlled by Supabase Auth."
                />
              </Field>
              <Field label="Phone">
                <input
                  name="phone"
                  defaultValue={realtor.phone ?? ""}
                  className="admin-input"
                  placeholder="905-555-1234"
                />
              </Field>
              <Field label="Alternate phones">
                <textarea
                  name="alternate_phones"
                  defaultValue={(realtor.alternate_phones ?? []).join("\n")}
                  rows={3}
                  className="admin-input min-h-24 resize-y"
                  placeholder={"905-555-1234\n647-555-9876"}
                />
                <p className="mt-1 text-[11px] text-realtor-muted">
                  One per line. Any of these numbers can trigger welcome-back
                  booking recognition.
                </p>
              </Field>
              <Field label="Brokerage">
                <input
                  name="brokerage"
                  defaultValue={realtor.brokerage ?? ""}
                  className="admin-input"
                  placeholder="Brokerage name"
                />
              </Field>
              <Field label="Website">
                <input
                  name="website_url"
                  defaultValue={realtor.website_url ?? ""}
                  className="admin-input"
                  placeholder="https://agent-site.com"
                />
              </Field>
              <Field label="Instagram">
                <input
                  name="instagram_url"
                  defaultValue={realtor.instagram_url ?? ""}
                  className="admin-input"
                  placeholder="https://instagram.com/agent"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Agent memory">
                  <textarea
                    name="internal_notes"
                    defaultValue={realtor.internal_notes ?? ""}
                    rows={4}
                    maxLength={2000}
                    className="admin-input min-h-28 resize-y"
                    placeholder="Example: Prefers branded tour first. Always CC the team lead. Likes YouTube links included in delivery."
                  />
                  <p className="mt-1 text-[11px] text-realtor-muted">
                    Private admin memory. This shows on booking/delivery pages,
                    and Pixel Assistant can use it when planning bookings or
                    delivery. Realtors never see it.
                  </p>
                </Field>
              </div>
              <div className="md:col-span-2">
                <StructuredMemoryFields memory={realtor.ai_memory} />
              </div>
              <div className="md:col-span-2">
                <Field label="Delivery CC emails">
                  <textarea
                    name="delivery_cc_emails"
                    defaultValue={(realtor.delivery_cc_emails ?? []).join("\n")}
                    rows={3}
                    className="admin-input min-h-24 resize-y"
                    placeholder={"assistant@example.com\nteam@example.com"}
                  />
                  <p className="mt-1 text-[11px] text-realtor-muted">
                    One per line. These are copied on every delivery email for
                    this realtor.
                  </p>
                </Field>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <MediaField
                title="Profile photo / headshot"
                currentUrl={realtor.profile_photo_url}
                fileName="profile_photo_file"
                clearName="clear_profile_photo"
              />
              <MediaField
                title="Brokerage logo"
                currentUrl={realtor.brokerage_logo_url}
                fileName="brokerage_logo_file"
                clearName="clear_brokerage_logo"
              />
            </div>

            {message ? (
              <p
                className={
                  "rounded-2xl border px-3 py-2 text-sm " +
                  (message.kind === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-red-200 bg-red-50 text-red-800")
                }
              >
                {message.text}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-full bg-realtor-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:opacity-60"
              >
                {isPending ? "Saving..." : "Save profile"}
              </button>
              <p className="text-xs text-realtor-muted">
                Changes show in the realtor portal and future listing page
                defaults.
              </p>
            </div>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function ProfileImage({ realtor }: { realtor: RealtorProfileView }) {
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-realtor-primary/15 bg-realtor-primary/10 text-sm font-bold text-realtor-primary">
      {realtor.profile_photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={realtor.profile_photo_url}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        initialsFor(realtor.full_name ?? realtor.email)
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function StructuredMemoryFields({ memory }: { memory: RealtorAIMemory }) {
  return (
    <section className="rounded-2xl border border-realtor-primary/15 bg-white/70 p-3">
      <div>
        <p className="text-sm font-semibold text-realtor-text">
          Smart memory
        </p>
        <p className="mt-1 text-xs text-realtor-muted">
          Structured preferences for booking recommendations, daily briefs, and
          Pixel Assistant. Realtors do not see this.
        </p>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <MemoryTextArea
          label="Usually books"
          name="memory_preferred_services"
          value={memory.preferredServices}
          placeholder={"Photos + iGUIDE\nSocial reels"}
        />
        <MemoryTextArea
          label="Common add-ons"
          name="memory_preferred_addons"
          value={memory.preferredAddOns}
          placeholder={"Drone\nTwilight"}
        />
        <MemoryTextArea
          label="Common cities / areas"
          name="memory_preferred_cities"
          value={memory.preferredCities}
          placeholder={"Burlington\nHamilton"}
        />
        <Field label="Typical square footage">
          <input
            name="memory_typical_sqft"
            defaultValue={memory.typicalSquareFootage ?? ""}
            inputMode="numeric"
            className="admin-input"
            placeholder="2200"
          />
        </Field>
        <MemoryTextArea
          label="Delivery preferences"
          name="memory_delivery_preferences"
          value={memory.deliveryPreferences}
          placeholder={"Send branded and unbranded tour\nAlways include video link"}
        />
        <Field label="Communication style">
          <input
            name="memory_communication_style"
            defaultValue={memory.communicationStyle ?? ""}
            className="admin-input"
            placeholder="Short texts, no long emails"
          />
        </Field>
        <MemoryTextArea
          label="Access notes"
          name="memory_access_notes"
          value={memory.accessNotes}
          placeholder={"Often uses lockbox\nPrefers morning shoots"}
        />
        <Field label="Invoice preferences">
          <input
            name="memory_invoice_preferences"
            defaultValue={memory.invoicePreferences ?? ""}
            className="admin-input"
            placeholder="Invoice brokerage, not agent"
          />
        </Field>
        <div className="md:col-span-2">
          <MemoryTextArea
            label="Do not remind about"
            name="memory_avoid_reminders"
            value={memory.avoidReminders}
            placeholder={"Upsells\nDelivery follow-ups"}
          />
        </div>
      </div>
    </section>
  );
}

function MemoryTextArea({
  label,
  name,
  value,
  placeholder,
}: {
  label: string;
  name: string;
  value: string[];
  placeholder: string;
}) {
  return (
    <Field label={label}>
      <textarea
        name={name}
        defaultValue={value.join("\n")}
        rows={3}
        className="admin-input min-h-20 resize-y"
        placeholder={placeholder}
      />
    </Field>
  );
}

function MediaField({
  title,
  currentUrl,
  fileName,
  clearName,
}: {
  title: string;
  currentUrl: string | null;
  fileName: string;
  clearName: string;
}) {
  return (
    <div className="rounded-2xl border border-realtor-primary/15 bg-white/70 p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-realtor-primary/15 bg-realtor-primary/5 text-[10px] font-semibold uppercase text-realtor-muted">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            "None"
          )}
        </div>
        <div>
          <p className="text-sm font-semibold text-realtor-text">{title}</p>
          <p className="text-xs text-realtor-muted">
            Upload a JPG, PNG, WebP, or GIF.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <input
          name={fileName}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="block w-full rounded-xl border border-realtor-primary/15 bg-white px-3 py-2 text-xs text-realtor-text file:mr-3 file:rounded-full file:border-0 file:bg-realtor-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
        />
        <label className="flex items-center gap-2 text-xs text-realtor-muted">
          <input
            type="checkbox"
            name={clearName}
            className="h-4 w-4 rounded border-realtor-primary/20 text-realtor-primary"
          />
          Clear this image
        </label>
      </div>
    </div>
  );
}

function hasStructuredMemory(memory: RealtorAIMemory): boolean {
  return Boolean(
    memory.preferredServices.length ||
      memory.preferredAddOns.length ||
      memory.preferredCities.length ||
      memory.typicalSquareFootage ||
      memory.deliveryPreferences.length ||
      memory.communicationStyle ||
      memory.accessNotes.length ||
      memory.invoicePreferences ||
      memory.avoidReminders.length,
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-realtor-primary/10 bg-white/70 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider">{label}</p>
      <p className="mt-0.5 text-base font-semibold text-realtor-text">{value}</p>
    </div>
  );
}

function initialsFor(nameOrEmail: string): string {
  const name = nameOrEmail.split("@")[0]?.replace(/[._-]+/g, " ") ?? "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PB";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}
