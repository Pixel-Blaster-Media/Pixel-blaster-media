"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import { setNewPassword, type ResetConfirmState } from "./actions";

const initial: ResetConfirmState | null = null;

export default function ResetConfirmForm() {
  const [state, formAction] = useActionState(setNewPassword, initial);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
          New password <span className="text-realtor-primary">*</span>
        </span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={
            "mt-1 min-h-11 w-full rounded-xl border bg-realtor-surface px-3 py-2 text-realtor-text placeholder-realtor-muted focus:outline-none focus:ring-2 focus:ring-realtor-primary/60 " +
            (state?.error ? "border-red-400/60" : "border-realtor-primary/15")
          }
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
          Confirm new password <span className="text-realtor-primary">*</span>
        </span>
        <input
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={
            "mt-1 min-h-11 w-full rounded-xl border bg-realtor-surface px-3 py-2 text-realtor-text placeholder-realtor-muted focus:outline-none focus:ring-2 focus:ring-realtor-primary/60 " +
            (state?.error ? "border-red-400/60" : "border-realtor-primary/15")
          }
        />
      </label>

      {state?.error ? (
        <div className="space-y-3">
          <p role="alert" className="text-xs text-red-700">
            {state.error}
          </p>
          {state.needsFreshLink ? (
            <Link
              href="/auth/reset"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-realtor-primary/20 bg-white px-4 py-2 text-sm font-semibold text-realtor-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary"
            >
              Request a new reset link
            </Link>
          ) : null}
        </div>
      ) : null}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 w-full rounded-full bg-realtor-primary px-4 py-2.5 font-semibold text-white hover:bg-realtor-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-realtor-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save new password"}
    </button>
  );
}
