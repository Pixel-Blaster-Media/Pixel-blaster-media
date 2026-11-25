"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import VendorFields, { VendorLogo } from "@/app/admin/VendorFields";
import type { VendorContact } from "@/lib/booking/vendor-invite-core";
import { changeBookingVendor } from "./vendor-actions";

type Invite = VendorContact & { id: string; instructions: string; status: string };

export default function VendorInvites({ bookingId, contacts, invites, canAdd }: {
  bookingId: string; contacts: VendorContact[]; invites: Invite[]; canAdd: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (operation: "add" | "remove" | "retry", form: FormData) => start(async () => {
    try {
      const result = await changeBookingVendor(bookingId, operation, form);
      setError(result.error);
      if (!result.error && operation === "add") setShow(false);
      router.refresh();
    } catch {
      setError("Could not check the invite. Refresh this booking before retrying.");
    }
  });
  return <section className="space-y-3 rounded-2xl border border-realtor-primary/15 p-4">
    <h2 className="font-semibold">Vendor invites</h2>
    {invites.length ? <ul className="space-y-2">{invites.map((invite) => <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-2"><VendorLogo key={invite.logo_url ?? ""} url={invite.logo_url} /><span>
        <strong>{invite.name || invite.email}</strong>
        {invite.name && <span className="block text-xs text-realtor-muted">{invite.email}</span>}
        <span className="block text-xs text-realtor-muted">{invite.status === "invited" ? "Synced to Google Calendar" : invite.status === "cancelling" ? "Cancellation pending" : "Invite or update pending"}</span>
      </span></span>
      {canAdd && invite.status !== "cancelling" && <form action={(form) => run("remove", form)}>
        <input type="hidden" name="vendor_id" value={invite.id} />
        <button type="submit" disabled={pending} className="text-xs underline">Cancel vendor invite</button>
      </form>}
    </li>)}</ul> : <p className="text-xs text-realtor-muted">No vendors invited.</p>}
    {invites.some((invite) => invite.status !== "invited") && <button type="button" disabled={pending} onClick={() => run("retry", new FormData())} className="text-sm underline">Retry calendar sync</button>}
    {error && <p role="status" className="text-sm text-amber-800">{error}</p>}
    {canAdd && (show ? <form action={(form) => run("add", form)} className="space-y-3">
      <VendorFields contacts={contacts} required />
      <button type="submit" disabled={pending} className="rounded-xl bg-realtor-primary px-3 py-2 text-sm text-white">{pending ? "Saving…" : "Send vendor invite"}</button>
      <button type="button" className="ml-3 text-sm underline" onClick={() => setShow(false)}>Close</button>
    </form> : <button type="button" className="rounded-xl border px-3 py-2 text-sm font-semibold" onClick={() => setShow(true)}>+ Add vendor</button>)}
  </section>;
}
