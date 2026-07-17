"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { requestPasswordReset, type ResetRequestState } from "./actions";

const initial: ResetRequestState | null = null;

export default function ResetRequestForm({
  initialEmail,
}: {
  initialEmail: string;
}) {
  const [state, formAction] = useActionState(requestPasswordReset, initial);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
          Email address <span className="text-realtor-primary">*</span>
        </span>
        <input
          name="email"
          type="email"
          defaultValue={initialEmail}
          required
          autoComplete="email"
          className={
            "mt-1 min-h-11 w-full rounded-xl border bg-realtor-surface px-3 py-2 text-realtor-text placeholder-realtor-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary " +
            (state?.error ? "border-red-400/60" : "border-realtor-primary/15")
          }
        />
      </label>

      {state?.error ? (
        <p role="alert" className="text-xs text-red-700">
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
      className="min-h-11 w-full rounded-full bg-realtor-primary px-4 py-2.5 font-semibold text-white hover:bg-realtor-primary-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Sending…" : "Send reset link"}
    </button>
  );
}
