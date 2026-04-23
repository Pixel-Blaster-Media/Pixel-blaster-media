"use client";

import { useFormState, useFormStatus } from "react-dom";

import { requestPasswordReset, type ResetRequestState } from "./actions";

const initial: ResetRequestState | null = null;

export default function ResetRequestForm() {
  const [state, formAction] = useFormState(requestPasswordReset, initial);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          Email address <span className="text-brand-light">*</span>
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
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
      {pending ? "Sending…" : "Send reset link"}
    </button>
  );
}
