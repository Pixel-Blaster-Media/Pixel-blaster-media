"use client";

import { useFormState, useFormStatus } from "react-dom";

import { setNewPassword, type ResetConfirmState } from "./actions";

const initial: ResetConfirmState | null = null;

export default function ResetConfirmForm() {
  const [state, formAction] = useFormState(setNewPassword, initial);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          New password <span className="text-brand-light">*</span>
        </span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={
            "mt-1 w-full rounded-md border bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
            (state?.error ? "border-red-400/60" : "border-white/10")
          }
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          Confirm new password <span className="text-brand-light">*</span>
        </span>
        <input
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={
            "mt-1 w-full rounded-md border bg-ink-soft px-3 py-2 text-white placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-light/60 " +
            (state?.error ? "border-red-400/60" : "border-white/10")
          }
        />
      </label>

      {state?.error ? (
        <p role="alert" className="text-xs text-red-300">
          {state.error}
        </p>
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
      className="w-full rounded-md bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save new password"}
    </button>
  );
}
