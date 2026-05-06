"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";

import {
  signInWithPassword,
  type PasswordSignInState,
} from "./actions";

const initial: PasswordSignInState | null = null;

export default function PasswordSignInForm({ next }: { next?: string }) {
  const [state, formAction] = useFormState(signInWithPassword, initial);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/admin"} />
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
          Email
        </span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-light/60"
        />
      </label>
      <label className="block">
        <span className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-ink-muted">
          <span>Password</span>
          <Link
            href="/auth/reset"
            className="text-[11px] normal-case tracking-normal text-brand-light hover:underline"
          >
            Forgot password?
          </Link>
        </span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-md border border-white/10 bg-ink-soft px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-light/60"
        />
      </label>
      {state?.error ? (
        <p className="text-sm text-red-300" role="alert">
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
      className="w-full rounded-md bg-brand px-4 py-2 font-semibold text-white transition hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
