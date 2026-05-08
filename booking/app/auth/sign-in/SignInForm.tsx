"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { sendMagicLink, type SignInState } from "./actions";

const initial: SignInState | null = null;

export default function SignInForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(sendMagicLink, initial);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/admin"} />
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wider text-realtor-muted">
          Email
        </span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          className="realtor-field mt-1 w-full rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-realtor-primary/60"
        />
      </label>
      {state?.error ? (
        <p className="text-sm text-red-700" role="alert">
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
      className="w-full rounded-full bg-realtor-primary px-4 py-2 font-semibold text-white transition hover:bg-realtor-primary-light disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Sending…" : "Email me a sign-in link"}
    </button>
  );
}
