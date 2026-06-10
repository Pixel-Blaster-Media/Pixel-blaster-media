import "server-only";

import {
  labelForAddOn,
  labelForService,
  PREFERRED_TIMES,
} from "@/lib/booking/services";

/**
 * Subset of BookingRequestInput that email templates actually need.
 * Kept narrow so we don't widen its shape when the request schema evolves
 * (e.g. cart[] lives on the main input but templates only need rendered
 * service/add-on slug arrays).
 */
interface TemplateRequest {
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  brokerage?: string;
  street_address: string;
  city?: string;
  postal_code?: string;
  square_footage?: number;
  services: string[];
  add_ons: string[];
  preferred_date?: string;
  preferred_time?: string;
  notes?: string;
}

interface TemplateArgs {
  request: TemplateRequest;
  requestId: string;
}

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

function timeLabel(id?: string): string {
  if (!id) return "—";
  return PREFERRED_TIMES.find((t) => t.id === id)?.label ?? id;
}

function summary(request: TemplateRequest): string {
  const services = request.services.map(labelForService).join(", ") || "—";
  const addOns = request.add_ons.length
    ? request.add_ons.map(labelForAddOn).join(", ")
    : "—";
  const address = [
    request.street_address,
    [request.city, request.postal_code].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return `
    <h2>Property</h2>
    <p>${escape(address)}${
      request.square_footage ? ` · ${request.square_footage} sq ft` : ""
    }</p>

    <h2>Services</h2>
    <p>${escape(services)}</p>

    <h2>Add-ons</h2>
    <p>${escape(addOns)}</p>

    <h2>Preferred timing</h2>
    <p>${escape(request.preferred_date ?? "—")} · ${escape(timeLabel(request.preferred_time))}</p>

    ${
      request.notes
        ? `<h2>Notes</h2><p>${escape(request.notes).replace(/\n/g, "<br>")}</p>`
        : ""
    }
  `;
}

export function clientConfirmationEmail({ request, requestId }: TemplateArgs) {
  const html = `
    <!doctype html>
    <html><head><meta charset="utf-8"><style>${baseStyles}</style></head>
    <body><div class="wrap">
      <p><span class="pill">Pixel Blaster Media</span></p>
      <h1>Thanks ${escape(request.contact_name.split(" ")[0])}, we got your request.</h1>
      <p>We'll get back to you within 24 hours to confirm the date and any details. Below is a copy of what you sent us — keep it for your records.</p>
      ${summary(request)}
      <p class="meta">Request ID: ${escape(requestId)}<br>
        Reply to this email with anything you'd like to add or change.</p>
    </div></body></html>
  `;
  return {
    subject: "We got your booking request — Pixel Blaster Media",
    html,
  };
}

export function adminNotificationEmail({ request, requestId }: TemplateArgs) {
  const html = `
    <!doctype html>
    <html><head><meta charset="utf-8"><style>${baseStyles}</style></head>
    <body><div class="wrap">
      <p><span class="pill">New booking request</span></p>
      <h1>${escape(request.contact_name)}${
        request.brokerage ? ` · ${escape(request.brokerage)}` : ""
      }</h1>
      <p>
        <strong>Email:</strong> ${escape(request.contact_email)}<br>
        ${request.contact_phone ? `<strong>Phone:</strong> ${escape(request.contact_phone)}<br>` : ""}
      </p>
      ${summary(request)}
      <p class="meta">Request ID: ${escape(requestId)} · open in admin to accept or decline.</p>
    </div></body></html>
  `;
  return {
    subject: `New booking — ${request.street_address}`,
    html,
  };
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
  scheduledAt,
  services,
  portalLink,
  companyName = "Pixel Blaster Media",
}: {
  contactName: string;
  streetAddress: string;
  scheduledAt: string | null;
  services: string[];
  portalLink: string;
  companyName?: string;
}) {
  const firstName = contactName.split(" ")[0] || contactName;
  const when = scheduledAt
    ? new Date(scheduledAt).toLocaleString(undefined, {
        dateStyle: "full",
        timeStyle: "short",
      })
    : null;
  const serviceList = services.length
    ? services.map(labelForService).join(", ")
    : "—";

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
      .fallback {
        word-break: break-all;
        color: #8a979c;
        font-size: 12px;
      }
    </style></head>
    <body><div class="wrap">
      <p><span class="pill">Booking confirmed</span></p>
      <h1>You're all set, ${escape(firstName)}.</h1>
      <p>Your shoot at <strong>${escape(streetAddress)}</strong> is confirmed${
        when ? ` for <strong>${escape(when)}</strong>` : ""
      }.</p>

      <h2>Your new portal</h2>
      <p>We've set up a private portal for you. As we work on your listing, your virtual tour, floor plan, and gallery will appear in one place — no more digging through emails for the right link.</p>

      <p><a href="${escape(portalLink)}" class="cta">Open your portal →</a></p>

      <p class="fallback">
        If the button doesn't work, paste this link into your browser:<br>
        ${escape(portalLink)}
      </p>

      <h2>What you booked</h2>
      <p>${escape(serviceList)}</p>

      <p class="meta">Reply to this email with anything you'd like to add or change. We'll be in touch as the shoot day approaches.</p>
    </div></body></html>
  `;

  return {
    subject: `Your ${companyName} shoot is confirmed — ${streetAddress}`,
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
      <p><span class="pill">Shoot tomorrow</span></p>
      <h1>See you tomorrow, ${escape(firstName)}.</h1>
      <p>Your shoot at <strong>${escape(address)}</strong> is tomorrow at <strong>${escape(timeLabel)}</strong>.</p>

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
    subject: `Reminder: your shoot tomorrow at ${timeLabel} — ${streetAddress}`,
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

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
