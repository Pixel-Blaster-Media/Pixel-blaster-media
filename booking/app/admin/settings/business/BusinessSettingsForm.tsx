"use client";

import { useActionState } from "react";
import { useState } from "react";

import {
  saveBusinessSettings,
  type BusinessSettingsResult,
} from "./actions";

interface BusinessSettingsFormProps {
  organization: {
    name: string;
    slug: string;
    primary_color: string | null;
    accent_color: string | null;
    logo_url: string | null;
    booking_hero_image_url: string | null;
    booking_hero_secondary_image_url: string | null;
    email_from_name: string | null;
    reply_to_email: string | null;
    admin_notification_email: string | null;
  };
}

export default function BusinessSettingsForm({
  organization,
}: BusinessSettingsFormProps) {
  const [state, action, pending] = useActionState<
    BusinessSettingsResult,
    FormData
  >(saveBusinessSettings, { ok: false });

  const primaryColor = organization.primary_color ?? "#3f7f5f";
  const accentColor = organization.accent_color ?? "#c9a35b";
  const [businessName, setBusinessName] = useState(organization.name);
  const [bookingHandle, setBookingHandle] = useState(organization.slug);
  const [handleEdited, setHandleEdited] = useState(false);
  const [previewLogoUrl, setPreviewLogoUrl] = useState(organization.logo_url ?? "");
  const [clearLogo, setClearLogo] = useState(false);
  const [previewHeroImageUrl, setPreviewHeroImageUrl] = useState(
    organization.booking_hero_image_url ?? "",
  );
  const [clearHeroImage, setClearHeroImage] = useState(false);
  const [previewHeroSecondaryImageUrl, setPreviewHeroSecondaryImageUrl] =
    useState(organization.booking_hero_secondary_image_url ?? "");
  const [clearHeroSecondaryImage, setClearHeroSecondaryImage] = useState(false);

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-sm shadow-realtor-text/5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Company
          </p>
          <div className="mt-4 grid gap-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Business name
              </span>
              <input
                name="name"
                value={businessName}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setBusinessName(value);
                  if (!handleEdited) setBookingHandle(slugify(value));
                }}
                required
                maxLength={80}
                className="mt-1 box-border w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/60 focus:border-realtor-primary/45"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Booking handle
              </span>
              <input
                name="slug"
                value={bookingHandle}
                onChange={(event) => {
                  setHandleEdited(true);
                  setBookingHandle(slugify(event.currentTarget.value));
                }}
                required
                maxLength={60}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                className="mt-1 box-border w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/60 focus:border-realtor-primary/45"
              />
              <span className="mt-1 block text-xs leading-5 text-realtor-muted">
                Public booking link:{" "}
                <code className="rounded-md bg-realtor-surface-muted px-1.5 py-0.5 text-realtor-text">
                  /book?org={bookingHandle || "your-company"}
                </code>
                . Spaces automatically become hyphens.
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
                Logo
              </span>
              <span className="mt-1 flex flex-col gap-3 rounded-2xl border border-realtor-primary/15 bg-realtor-surface/70 p-3 sm:flex-row sm:items-center">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-realtor-primary/15 bg-realtor-primary/10 text-xs font-bold text-realtor-primary">
                  {previewLogoUrl && !clearLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewLogoUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    "Logo"
                  )}
                </span>
                <span className="grid min-w-0 flex-1 gap-2">
                  <input
                    name="logo_file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) {
                        setPreviewLogoUrl(URL.createObjectURL(file));
                        setClearLogo(false);
                      }
                    }}
                    className="block w-full text-sm text-realtor-muted file:mr-3 file:rounded-full file:border-0 file:bg-realtor-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-realtor-primary/90"
                  />
                  {organization.logo_url ? (
                    <label className="inline-flex items-center gap-2 text-xs text-realtor-muted">
                      <input
                        type="checkbox"
                        name="clear_logo"
                        checked={clearLogo}
                        onChange={(event) => setClearLogo(event.currentTarget.checked)}
                        className="h-4 w-4 accent-realtor-primary"
                      />
                      Remove current logo
                    </label>
                  ) : null}
                </span>
              </span>
              <span className="mt-1 block text-xs leading-5 text-realtor-muted">
                This appears at the top of the public booking page and in
                account areas. JPG, PNG, WebP, GIF, or SVG works best.
              </span>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-sm shadow-realtor-text/5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Brand colors
          </p>
          <div className="mt-4 grid gap-4">
            <ColorField
              label="Primary"
              name="primary_color"
              defaultValue={primaryColor}
            />
            <ColorField
              label="Accent"
              name="accent_color"
              defaultValue={accentColor}
            />
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/80 p-5 shadow-sm shadow-realtor-text/5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
              Public booking page
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-realtor-muted">
              These images fill the top of the booking page. Use a finished
              exterior, twilight, interior detail, or brand image that feels
              like the company.
            </p>
          </div>
          <span className="rounded-full border border-realtor-primary/15 bg-realtor-surface px-3 py-1 text-xs font-semibold text-realtor-primary">
            Shows on /book
          </span>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <BrandImageUpload
            label="Main booking photo"
            name="booking_hero_image_file"
            clearName="clear_booking_hero_image"
            currentUrl={organization.booking_hero_image_url}
            previewUrl={previewHeroImageUrl}
            clear={clearHeroImage}
            previewClassName="aspect-[16/9]"
            emptyLabel="Main photo"
            help="This fills the large image block on the booking page."
            onClearChange={setClearHeroImage}
            onPreviewChange={setPreviewHeroImageUrl}
          />
          <BrandImageUpload
            label="Secondary image"
            name="booking_hero_secondary_image_file"
            clearName="clear_booking_hero_secondary_image"
            currentUrl={organization.booking_hero_secondary_image_url}
            previewUrl={previewHeroSecondaryImageUrl || organization.logo_url || ""}
            clear={clearHeroSecondaryImage}
            previewClassName="aspect-[4/3]"
            emptyLabel="Logo or image"
            help="Optional accent image for the smaller booking page media block."
            onClearChange={setClearHeroSecondaryImage}
            onPreviewChange={setPreviewHeroSecondaryImageUrl}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/80 p-5 shadow-sm shadow-realtor-text/5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
          Email identity
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-realtor-muted">
          These control how emails look and where replies go for this company.
          The verified sender address still stays in Resend so delivery stays
          reliable.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
              Sender name
            </span>
            <input
              name="email_from_name"
              defaultValue={organization.email_from_name ?? organization.name}
              maxLength={80}
              placeholder={organization.name}
              className="mt-1 box-border w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/60 focus:border-realtor-primary/45"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
              Reply-to email
            </span>
            <input
              name="reply_to_email"
              type="email"
              defaultValue={organization.reply_to_email ?? ""}
              placeholder="hello@company.com"
              className="mt-1 box-border w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/60 focus:border-realtor-primary/45"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
              Admin alerts
            </span>
            <input
              name="admin_notification_email"
              type="email"
              defaultValue={organization.admin_notification_email ?? ""}
              placeholder="owner@company.com"
              className="mt-1 box-border w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/60 focus:border-realtor-primary/45"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/80 p-5 shadow-sm shadow-realtor-text/5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-realtor-text">
              SaaS readiness
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-realtor-muted">
              These settings belong to this company only. Later, new
              businesses will get their own profile, calendar, catalog, and
              integrations instead of sharing Pixel Blaster settings.
            </p>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-realtor-text/10 transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {pending ? "Saving..." : "Save business profile"}
          </button>
        </div>
        {state.error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.error}
          </p>
        ) : null}
        {state.ok ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Business profile saved.
          </p>
        ) : null}
      </section>
    </form>
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

function BrandImageUpload({
  label,
  name,
  clearName,
  currentUrl,
  previewUrl,
  clear,
  previewClassName,
  emptyLabel,
  help,
  onClearChange,
  onPreviewChange,
}: {
  label: string;
  name: string;
  clearName: string;
  currentUrl: string | null;
  previewUrl: string;
  clear: boolean;
  previewClassName: string;
  emptyLabel: string;
  help: string;
  onClearChange: (value: boolean) => void;
  onPreviewChange: (value: string) => void;
}) {
  const visiblePreview = previewUrl && !clear;

  return (
    <div className="block rounded-2xl border border-realtor-primary/15 bg-white p-3 shadow-sm shadow-realtor-text/5">
      <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
        {label}
      </span>
      <span
        className={`mt-2 flex w-full items-center justify-center overflow-hidden rounded-2xl border border-realtor-primary/15 bg-realtor-surface-muted text-xs font-bold uppercase tracking-[0.16em] text-realtor-primary ${previewClassName}`}
      >
        {visiblePreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          emptyLabel
        )}
      </span>
      <span className="mt-3 grid gap-2">
        <input
          name={name}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              onPreviewChange(URL.createObjectURL(file));
              onClearChange(false);
            }
          }}
          className="block w-full text-sm text-realtor-muted file:mr-3 file:rounded-full file:border-0 file:bg-realtor-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-realtor-primary/90"
        />
        {currentUrl ? (
          <label className="inline-flex items-center gap-2 text-xs text-realtor-muted">
            <input
              type="checkbox"
              name={clearName}
              checked={clear}
              onChange={(event) => onClearChange(event.currentTarget.checked)}
              className="h-4 w-4 accent-realtor-primary"
            />
            Remove current image
          </label>
        ) : null}
      </span>
      <span className="mt-2 block text-xs leading-5 text-realtor-muted">
        {help}
      </span>
    </div>
  );
}

function ColorField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  const [color, setColor] = useState(defaultValue);

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
          aria-label={`${label} color`}
        />
        <input
          name={name}
          value={color}
          onChange={(event) => setColor(event.currentTarget.value)}
          pattern="#[0-9a-fA-F]{6}"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-realtor-text outline-none"
          aria-label={`${label} hex color`}
        />
      </span>
    </label>
  );
}
