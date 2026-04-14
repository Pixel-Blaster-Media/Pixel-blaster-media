import "server-only";

import {
  labelForAddOn,
  labelForService,
  PREFERRED_TIMES,
} from "@/lib/booking/services";
import type { BookingRequestInput } from "@/lib/booking/schema";

interface TemplateArgs {
  request: BookingRequestInput;
  requestId: string;
}

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

function summary(request: BookingRequestInput): string {
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

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
