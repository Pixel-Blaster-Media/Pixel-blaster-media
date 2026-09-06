import "server-only";

import { BUSINESS_TZ } from "@/lib/booking/availability";
import { labelForService } from "@/lib/booking/services";

import type { DeliveryLinkCategory } from "@/lib/booking/delivery-links";

const BRAND_TEAL = "#22a4b5";
const INK = "#0b0f10";

const baseStyles = `
  body { background:${INK}; color:#e8eef0; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif; margin:0; padding:0; }
  .wrap { max-width:560px; margin:0 auto; padding:32px 24px; }
  h1,h2,h3 { color:#fff; margin:0 0 12px; }
  h1 { font-size:22px; }
  h2 { font-size:16px; margin-top:24px; }
  p  { color:#cfd6d8; line-height:1.55; margin:0 0 12px; font-size:15px; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; background:rgba(34,164,181,0.18); color:${BRAND_TEAL}; font-size:12px; }
  ul { padding-left:18px; color:#cfd6d8; line-height:1.55; font-size:15px; }
  .meta { color:#8a979c; font-size:12px; margin-top:24px; border-top:1px solid rgba(255,255,255,0.08); padding-top:16px; }
`;

export function bookingGoogleCalendarLink(args: {
  title: string;
  start: Date;
  end: Date;
  location: string;
  details: string;
}): string {
  const format = (date: Date) =>
    date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: args.title,
    dates: `${format(args.start)}/${format(args.end)}`,
    location: args.location,
    details: args.details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function bookingIcsCalendarLink(
  appUrl: string,
  args: {
    start: Date;
    end: Date;
    address: string;
    services: string;
    organizationName: string;
  },
): string {
  const url = new URL("/book/success/ics", appUrl);
  url.searchParams.set("start", args.start.toISOString());
  url.searchParams.set("end", args.end.toISOString());
  url.searchParams.set("address", args.address);
  url.searchParams.set("services", args.services);
  url.searchParams.set("org", args.organizationName);
  return url.toString();
}

/**
 * Sent to the realtor when an admin accepts their booking request.
 *
 * The `portalLink` is a Supabase-generated magic link so the realtor
 * signs in with a single click — no need to type their email or
 * wait for a separate sign-in email. Link typically lands them at
 * `/portal` already authenticated.
 */
export function shootConfirmedEmail({
  contactName,
  streetAddress,
  city,
  scheduledAt,
  scheduledEndsAt,
  services,
  addOns = [],
  portalLink,
  manageLink,
  googleCalendarLink,
  calendarDownloadLink,
  invoiceLink,
  companyName = "Pixel Blaster Media",
}: {
  contactName: string;
  streetAddress: string;
  city?: string | null;
  scheduledAt: string | null;
  scheduledEndsAt?: string | null;
  services: string[];
  addOns?: string[];
  portalLink: string;
  manageLink?: string | null;
  googleCalendarLink?: string | null;
  calendarDownloadLink?: string | null;
  invoiceLink?: string | null;
  companyName?: string;
}) {
  const firstName = contactName.split(" ")[0] || contactName;
  const when = scheduledAt
    ? new Date(scheduledAt).toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: BUSINESS_TZ,
      })
    : null;
  const endTime = scheduledEndsAt
    ? new Date(scheduledEndsAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: BUSINESS_TZ,
      })
    : null;
  const serviceList = services.length ? services.map(labelForService) : ["—"];
  const addOnList = addOns.map(labelForService);
  const address = [streetAddress, city].filter(Boolean).join(", ");
  const secondaryActions = [
    googleCalendarLink
      ? { label: "Add to Google Calendar", url: googleCalendarLink }
      : null,
    calendarDownloadLink
      ? { label: "Add to iCal / Outlook", url: calendarDownloadLink }
      : null,
    portalLink ? { label: "Open client portal", url: portalLink } : null,
  ].filter((action): action is { label: string; url: string } => Boolean(action));

  const html = `
    <!doctype html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
      body { background:#f3f5f6; color:#25292b; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif; margin:0; padding:0; }
      .wrap { max-width:620px; margin:0 auto; padding:28px 14px; }
      .card { background:#fff; border:1px solid #dde2e4; border-radius:12px; overflow:hidden; }
      .header { padding:30px 28px 20px; text-align:center; }
      .eyebrow { color:#758084; font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
      h1 { color:#202426; font-size:28px; line-height:1.2; margin:8px 0 6px; }
      .intro { color:#5f686b; font-size:15px; line-height:1.55; margin:0; }
      .summary { border-top:1px solid #e7ebec; border-bottom:1px solid #e7ebec; padding:22px 28px; }
      .row { padding:7px 0; }
      .label { color:#8a9295; display:inline-block; font-size:13px; font-weight:700; width:82px; vertical-align:top; }
      .value { color:#292e30; display:inline-block; font-size:15px; line-height:1.45; max-width:430px; }
      .actions { padding:24px 28px 10px; text-align:center; }
      .primary { background:${BRAND_TEAL}; border-radius:7px; color:#fff !important; display:block; font-size:15px; font-weight:700; margin:0 auto 12px; padding:13px 18px; text-decoration:none; }
      .secondary { background:#36383a; border-radius:7px; color:#fff !important; display:block; font-size:14px; font-weight:600; margin:0 auto 10px; padding:12px 18px; text-decoration:none; }
      .note { color:#758084; font-size:12px; line-height:1.55; margin:8px 28px 28px; text-align:center; }
    </style></head>
    <body><div class="wrap"><div class="card">
      <div class="header">
        <div class="eyebrow">Appointment scheduled</div>
        <h1>You're all set, ${escape(firstName)}.</h1>
        <p class="intro">Your ${escape(companyName)} media shoot is confirmed.</p>
      </div>
      <div class="summary">
        <div class="row"><span class="label">What</span><span class="value">${serviceList.map(escape).join(", ")}${addOnList.length ? `<br><span style="color:#667175">Add-ons: ${addOnList.map(escape).join(", ")}</span>` : ""}</span></div>
        <div class="row"><span class="label">When</span><span class="value">${escape(when ?? "Time to be confirmed")}${endTime ? ` – ${escape(endTime)}` : ""}</span></div>
        <div class="row"><span class="label">Where</span><span class="value">${escape(address)}</span></div>
      </div>
      <div class="actions">
        ${manageLink ? `<a href="${escape(manageLink)}" class="primary">Change or cancel booking</a>` : ""}
        ${secondaryActions.map((action) => `<a href="${escape(action.url)}" class="secondary">${escape(action.label)}</a>`).join("")}
        ${invoiceLink ? `<a href="${escape(invoiceLink)}" class="secondary">View or pay invoice</a>` : ""}
      </div>
      <p class="note">Reply to this email if you would like to add something to the package or if any property details change.</p>
    </div></div></body></html>
  `;

  return {
    subject: `Your ${companyName} shoot is confirmed — ${streetAddress}`,
    html,
  };
}

export function newBookingStaffEmail({
  realtorName,
  realtorEmail,
  realtorPhone,
  brokerage,
  streetAddress,
  city,
  scheduledAt,
  services,
  addOns,
  notes,
  squareFootage,
  occupancy,
  includeBasement,
  bookingLink,
  calendarLink,
  directionsLink,
  companyName = "Pixel Blaster Media",
}: {
  realtorName: string;
  realtorEmail: string;
  realtorPhone?: string | null;
  brokerage?: string | null;
  streetAddress: string;
  city?: string | null;
  scheduledAt: string;
  services: string[];
  addOns: string[];
  notes?: string | null;
  squareFootage?: number | null;
  occupancy?: string | null;
  includeBasement?: boolean | null;
  bookingLink?: string | null;
  calendarLink?: string | null;
  directionsLink?: string | null;
  companyName?: string;
}) {
  const when = new Date(scheduledAt).toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: BUSINESS_TZ,
  });
  const address = [streetAddress, city].filter(Boolean).join(", ");
  const propertyDetails = [
    squareFootage ? `${squareFootage.toLocaleString()} sq ft` : null,
    occupancy ? occupancyLabel(occupancy) : null,
    includeBasement === null || includeBasement === undefined
      ? null
      : includeBasement
        ? "Include basement"
        : "Skip basement",
  ].filter((value): value is string => Boolean(value));

  const html = `
    <!doctype html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
      body { background:#f3f5f6; color:#25292b; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif; margin:0; padding:0; }
      .wrap { max-width:620px; margin:0 auto; padding:28px 14px; }
      .card { background:#fff; border:1px solid #dde2e4; border-radius:12px; overflow:hidden; }
      .header { padding:26px 28px 18px; }
      .eyebrow { color:${BRAND_TEAL}; font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
      h1 { color:#202426; font-size:25px; line-height:1.2; margin:8px 0 4px; }
      .sub { color:#687174; font-size:14px; margin:0; }
      .summary { border-top:1px solid #e7ebec; padding:18px 28px; }
      .section { border-top:1px solid #e7ebec; padding:18px 28px; }
      .label { color:#8a9295; font-size:11px; font-weight:700; letter-spacing:.07em; margin:0 0 5px; text-transform:uppercase; }
      .value { color:#292e30; font-size:15px; line-height:1.5; margin:0 0 14px; }
      .actions { padding:4px 28px 18px; }
      .primary { background:${BRAND_TEAL}; border-radius:7px; color:#fff !important; display:block; font-size:15px; font-weight:700; margin:0 0 10px; padding:13px 18px; text-align:center; text-decoration:none; }
      .secondary { background:#36383a; border-radius:7px; color:#fff !important; display:block; font-size:14px; font-weight:600; margin:0 0 10px; padding:12px 18px; text-align:center; text-decoration:none; }
      .contact a { color:#147d8a; }
    </style></head>
    <body><div class="wrap"><div class="card">
      <div class="header"><div class="eyebrow">New booking</div><h1>${escape(address)}</h1><p class="sub">${escape(when)}</p></div>
      <div class="summary">
        <p class="label">Package</p><p class="value">${services.map(escape).join(", ") || "—"}${addOns.length ? `<br>Add-ons: ${addOns.map(escape).join(", ")}` : ""}</p>
        ${propertyDetails.length ? `<p class="label">Property</p><p class="value">${propertyDetails.map(escape).join(" · ")}</p>` : ""}
        ${notes ? `<p class="label">Realtor notes</p><p class="value">${escape(notes)}</p>` : ""}
      </div>
      <div class="section contact">
        <p class="label">Realtor</p><p class="value"><strong>${escape(realtorName)}</strong>${brokerage ? ` · ${escape(brokerage)}` : ""}<br><a href="mailto:${escape(realtorEmail)}">${escape(realtorEmail)}</a>${realtorPhone ? ` · <a href="tel:${escape(realtorPhone)}">${escape(realtorPhone)}</a>` : ""}</p>
      </div>
      <div class="actions">
        ${bookingLink ? `<a href="${escape(bookingLink)}" class="primary">Open booking</a>` : ""}
        ${directionsLink ? `<a href="${escape(directionsLink)}" class="secondary">Get directions</a>` : ""}
        ${calendarLink ? `<a href="${escape(calendarLink)}" class="secondary">Open booking calendar</a>` : ""}
      </div>
    </div></div></body></html>`;

  return {
    subject: `New booking — ${streetAddress} — ${companyName}`,
    html,
  };
}

/**
 * Day-before reminder sent by the /api/cron/reminders job the evening
 * before a shoot. The goal is purely practical: make sure the property
 * is photo-ready and someone can let the photographer in.
 *
 * `manageLink` is a signed self-serve link (/book/manage/[token]) so the
 * realtor can reschedule without emailing back and forth.
 */
export function shootReminderEmail({
  contactName,
  streetAddress,
  city,
  timeLabel,
  manageLink,
  companyName = "Pixel Blaster Media",
}: {
  contactName: string;
  streetAddress: string;
  city?: string | null;
  /** Already formatted in the business timezone, e.g. "10:30 a.m." */
  timeLabel: string;
  manageLink: string;
  companyName?: string;
}) {
  const firstName = contactName.split(" ")[0] || contactName;
  const address = [streetAddress, city].filter(Boolean).join(", ");

  const html = `
    <!doctype html>
    <html><head><meta charset="utf-8"><style>${baseStyles}
      .cta {
        display: inline-block;
        padding: 12px 20px;
        margin: 8px 0 20px;
        background: ${BRAND_TEAL};
        color: #fff !important;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 600;
      }
    </style></head>
    <body><div class="wrap">
      <p><span class="pill">Upcoming shoot</span></p>
      <h1>See you soon, ${escape(firstName)}.</h1>
      <p>Your shoot at <strong>${escape(address)}</strong> is scheduled for <strong>${escape(timeLabel)}</strong>.</p>

      <h2>Before we arrive</h2>
      <ul>
        <li>Make sure the property is photo-ready — lights on, blinds open, clutter and personal items tucked away.</li>
        <li>Arrange access: a lockbox code, someone on site, or an unlocked door.</li>
        <li>Clear vehicles from the driveway and street frontage if possible.</li>
      </ul>

      <h2>Need to change the time?</h2>
      <p><a href="${escape(manageLink)}" class="cta">Reschedule your shoot →</a></p>

      <p class="meta">Reply to this email if anything else comes up. — ${escape(companyName)}</p>
    </div></body></html>
  `;

  return {
    subject: `Reminder: your shoot ${timeLabel} — ${streetAddress}`,
    html,
  };
}

export function deliveryReadyEmail({
  contactName,
  streetAddress,
  portalLink,
  deliverables,
  invoiceUrl,
}: {
  contactName: string;
  streetAddress: string;
  portalLink: string;
  deliverables: Array<{
    label: string;
    url: string;
    category?: DeliveryLinkCategory;
  }>;
  /** Optional QuickBooks payment link — renders a "Pay your invoice" button. */
  invoiceUrl?: string | null;
}) {
  const firstName = contactName.split(" ")[0] || contactName;
  const groupedLinks = renderDeliveryLinkGroups(deliverables);

  const html = `
    <!doctype html>
    <html><head><meta charset="utf-8"><style>${baseStyles}
      .cta {
        display: inline-block;
        padding: 12px 20px;
        margin: 20px 0;
        background: ${BRAND_TEAL};
        color: #fff !important;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 600;
      }
      .link-card {
        border: 1px solid #2b454b;
        border-radius: 8px;
        padding: 14px;
        margin: 12px 0;
        background: #102124;
      }
      .link-card h2 {
        margin: 0 0 8px;
        font-size: 16px;
        color: #ffffff !important;
      }
      .link-card ul {
        margin: 0;
        padding-left: 18px;
        color: #cfd6d8;
      }
      .link-card li {
        margin: 6px 0;
        color: #cfd6d8;
      }
      .link-card a {
        color: #3dd5e8 !important;
      }
      .cta-pay {
        display: inline-block;
        padding: 12px 20px;
        margin: 8px 0 20px;
        background: #1b6f3c;
        color: #fff !important;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 600;
      }
      a { color:${BRAND_TEAL}; }
    </style></head>
    <body><div class="wrap">
      <p><span class="pill">Media ready</span></p>
      <h1>Your listing media is ready, ${escape(firstName)}.</h1>
      <p>The media for <strong>${escape(streetAddress)}</strong> is now available in your portal.</p>

      <p><a href="${escape(portalLink)}" class="cta">Open your media →</a></p>

      ${
        groupedLinks
          ? `<h2>Included media</h2>${groupedLinks}`
          : ""
      }

      ${
        invoiceUrl
          ? `<h2>Billing</h2>
      <p>Your invoice for this shoot is ready whenever you are.</p>
      <p><a href="${escape(invoiceUrl)}" class="cta-pay">Pay your invoice →</a></p>`
          : ""
      }

      <p class="meta">Reply to this email if anything needs attention or if you'd like changes.</p>
    </div></body></html>
  `;

  return {
    subject: `Your listing media is ready — ${streetAddress}`,
    html,
  };
}

function renderDeliveryLinkGroups(
  deliverables: Array<{
    label: string;
    url: string;
    category?: DeliveryLinkCategory;
  }>,
): string {
  const order: DeliveryLinkCategory[] = [
    "photos",
    "tour",
    "floor_plans",
    "video",
    "tools",
    "other",
  ];
  const titles: Record<DeliveryLinkCategory, string> = {
    photos: "Photos",
    tour: "Virtual tour",
    floor_plans: "Floor plans and PDFs",
    video: "Video",
    tools: "iGUIDE tools",
    other: "Other links",
  };

  return order
    .map((category) => {
      const links = deliverables.filter(
        (deliverable) => (deliverable.category ?? "other") === category,
      );
      if (links.length === 0) return "";
      const items = links
        .map(
          (deliverable) =>
            `<li><a href="${escape(deliverable.url)}">${escape(
              deliverable.label,
            )}</a></li>`,
        )
        .join("");
      return `<div class="link-card"><h2>${escape(titles[category])}</h2><ul>${items}</ul></div>`;
    })
    .join("");
}

function occupancyLabel(value: string): string {
  if (value === "vacant") return "Vacant";
  if (value === "partial") return "Partially occupied";
  if (value === "occupied") return "Occupied";
  return value;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
