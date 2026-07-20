"use client";

import { useActionState } from "react";

import {
  issueBetaInvite,
  type IssueBetaInviteResult,
} from "./beta-invite-actions";

const initialState: IssueBetaInviteResult = { ok: false };

export default function IssueBetaInviteForm() {
  const [state, action, pending] = useActionState(issueBetaInvite, initialState);

  return (
    <form
      action={action}
      className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface/85 p-5 shadow-sm shadow-realtor-text/5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-realtor-primary/80">
            Invite-only beta
          </p>
          <h2 className="mt-2 text-lg font-semibold text-realtor-text">
            Let an owner build their own company
          </h2>
          <p className="mt-2 text-sm leading-6 text-realtor-muted">
            Send an email-bound, single-use link. The owner chooses their company
            name, booking handle, branding, and starter catalogue. Pixel&apos;s
            customers and integration credentials are never copied.
          </p>
        </div>
        <span className="rounded-full border border-realtor-primary/20 bg-realtor-primary/10 px-3 py-1 text-xs font-semibold text-realtor-primary">
          Expires in 7 days
        </span>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-realtor-muted">
            Owner email
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="owner@example.com"
            className="mt-1 box-border w-full rounded-xl border border-realtor-primary/15 bg-realtor-surface px-3 py-2.5 text-sm text-realtor-text outline-none placeholder:text-realtor-muted/50 focus:border-realtor-primary/45"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-realtor-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-realtor-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {pending ? "Sending..." : "Invite beta company"}
        </button>
      </div>

      {state.error ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <p className="font-semibold">
            {state.invitationSent
              ? `Beta invitation sent to ${state.email}.`
              : `Invitation created for ${state.email}, but delivery was not confirmed.`}
          </p>
          {state.warning ? <p className="mt-1">{state.warning}</p> : null}
        </div>
      ) : null}
    </form>
  );
}
