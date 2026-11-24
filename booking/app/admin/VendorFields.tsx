"use client";

import { useState } from "react";
import type { VendorContact } from "@/lib/booking/vendor-invite-core";

export function VendorLogo({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    // Vendor-supplied image loads directly in the browser, never through an image proxy.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)}
      className="h-8 w-8 shrink-0 rounded border border-realtor-primary/15 bg-white object-contain" />
  );
}

const inputClass = "mt-1 block w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2 text-sm";

export default function VendorFields({ contacts, required = false }: { contacts: VendorContact[]; required?: boolean }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [open, setOpen] = useState(required);

  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="rounded-xl border px-3 py-2 text-sm font-semibold">
      + Add vendor
    </button>
  );
  return (
    <fieldset className="space-y-3 rounded-xl border border-realtor-primary/15 p-3 text-sm text-realtor-text">
      <legend className="px-1 font-semibold">Vendor invite</legend>
      <p className="text-xs text-realtor-muted">Sends a separate calendar invite with the date, time, address and the instructions below. No login, pricing or other booking notes.</p>
      {contacts.length ? (
        <label className="block">Saved vendor
          <select className={inputClass} value={contacts.some((contact) => contact.email === email) ? email : ""}
            onChange={(event) => {
              const contact = contacts.find((item) => item.email === event.target.value);
              setEmail(contact?.email ?? "");
              setName(contact?.name ?? "");
              setLogo(contact?.logo_url ?? "");
            }}>
            <option value="">Enter a new email</option>
            {contacts.map((contact) => <option key={contact.email} value={contact.email}>{contact.name ? `${contact.name} (${contact.email})` : contact.email}</option>)}
          </select>
        </label>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Vendor email<input className={inputClass} type="email" name="vendor_email" required={required} maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Name or company<input className={inputClass} name="vendor_name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <label className="block">Logo image URL (optional)
        <span className="flex items-center gap-2">
          <input className={inputClass} type="url" name="vendor_logo_url" maxLength={1000} value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…" />
          <VendorLogo key={contacts.find((c) => c.logo_url === logo)?.logo_url ?? ""} url={contacts.find((c) => c.logo_url === logo)?.logo_url ?? null} />
        </span>
      </label>
      <label className="block">Instructions to share<textarea name="vendor_instructions" className={inputClass} rows={2} maxLength={1500} /></label>
      <label className="flex items-center gap-2"><input name="vendor_save_contact" type="checkbox" /> Save vendor (including logo) for future bookings</label>
      {!required && <button type="button" className="text-xs underline" onClick={() => { setEmail(""); setName(""); setLogo(""); setOpen(false); }}>Don’t invite a vendor</button>}
    </fieldset>
  );
}
