"use client";

import { useActionState } from "react";

import {
  activateBetaCompany,
  reconcileBetaCompany,
  revokeBetaInvite,
  type BetaAdminMutationResult,
} from "./beta-invite-actions";

const initialState: BetaAdminMutationResult = { ok: false };

export default function BetaAdminMutationForm({
  kind,
  id,
}: {
  kind: "activate" | "reconcile" | "revoke";
  id: string;
}) {
  const action =
    kind === "activate"
      ? activateBetaCompany
      : kind === "reconcile"
        ? reconcileBetaCompany
        : revokeBetaInvite;
  const [state, submit, pending] = useActionState(action, initialState);
  const label =
    kind === "activate"
      ? "Activate booking link"
      : kind === "reconcile"
        ? "Reconcile provisioning"
        : "Revoke";

  return (
    <form action={submit} className="flex flex-wrap items-center gap-2">
      <input
        type="hidden"
        name={kind === "activate" ? "organization_id" : "invite_id"}
        value={id}
      />
      <button
        type="submit"
        disabled={pending}
        className={
          kind === "activate"
            ? "rounded-full bg-realtor-primary px-3 py-1.5 font-semibold text-white disabled:opacity-55"
            : "rounded-full border border-realtor-primary/20 px-3 py-1.5 font-semibold text-realtor-primary disabled:opacity-55"
        }
      >
        {pending ? "Working..." : label}
      </button>
      {state.error ? (
        <span className="text-xs font-medium text-red-700">{state.error}</span>
      ) : null}
      {state.ok && state.message ? (
        <span className="text-xs font-medium text-emerald-700">{state.message}</span>
      ) : null}
    </form>
  );
}
