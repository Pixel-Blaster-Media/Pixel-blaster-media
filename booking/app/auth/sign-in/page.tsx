import type { Metadata } from "next";
import Link from "next/link";

import {
  buildLoginContinuationPath,
  type LoginAudience,
} from "@/lib/auth/account-destination";

import PasswordSignInForm from "../password/PasswordSignInForm";

export const metadata: Metadata = {
  title: "Log in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    audience?: string;
    next?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const audience = parseAudience(params.audience);
  const errorMessage = authErrorMessage(params.error);

  if (!audience) {
    return (
      <div className="space-y-6">
        <AuthError message={errorMessage} />
        <AudienceChooser />
      </div>
    );
  }

  const isCompany = audience === "company";
  const continuation = buildLoginContinuationPath(audience, params.next ?? null);
  const magicHref = `/auth/magic?audience=${audience}&next=${encodeURIComponent(continuation)}`;

  return (
    <div className="space-y-6">
      <Link
        href="/auth/sign-in"
        className="text-sm font-semibold text-realtor-primary hover:text-realtor-text"
      >
        ← Choose another account type
      </Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary">
          {isCompany ? "Photography company" : "Realtor or agent"}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-realtor-text">
          {isCompany ? "Open your company workspace" : "Open your client portal"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-realtor-muted">
          {isCompany
            ? "Manage bookings, availability, pricing, integrations, and delivery."
            : "Book shoots, manage listings, and download delivered media."}
        </p>
      </header>
      <AuthError message={errorMessage} />

      <PasswordSignInForm next={continuation} />

      <div className="space-y-2 text-xs leading-5 text-realtor-muted">
        <p>
          Prefer a one-time email link?{" "}
          <Link href={magicHref} className="font-semibold text-realtor-primary underline">
            Use magic link sign-in
          </Link>
          .
        </p>
      </div>

      {isCompany ? (
        <aside className="rounded-2xl border border-realtor-primary/12 bg-realtor-surface-muted/60 p-4 text-sm leading-6 text-realtor-muted">
          <p className="font-semibold text-realtor-text">
            Invitation required during beta
          </p>
          <p className="mt-1">
            New photography companies are created by invitation. Use the email
            address that received your owner invite.
          </p>
        </aside>
      ) : (
        <aside className="rounded-2xl border border-realtor-primary/12 bg-realtor-surface-muted/60 p-4 text-sm leading-6 text-realtor-muted">
          <p className="font-semibold text-realtor-text">New to Pixel Blaster?</p>
          <p className="mt-1">
            Your realtor account is created when you book your first shoot.
          </p>
          <Link href="/book" className="mt-2 inline-flex font-semibold text-realtor-primary underline">
            Book a shoot
          </Link>
        </aside>
      )}
    </div>
  );
}

function AudienceChooser() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary">
          Pixel Blaster
        </p>
        <h1 className="mt-2 text-3xl font-bold text-realtor-text">
          Where do you want to log in?
        </h1>
        <p className="mt-2 text-sm leading-6 text-realtor-muted">
          Choose the workspace you use. Your actual account permissions are
          verified after login.
        </p>
      </header>

      <div className="grid gap-3">
        <Link
          href="/auth/sign-in?audience=company&next=/admin"
          className="group rounded-2xl border border-realtor-primary/15 bg-realtor-surface p-5 transition hover:border-realtor-primary/40 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary"
        >
          <span className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-lg font-semibold text-realtor-text">
                Photography company
              </span>
              <span className="mt-1 block text-sm leading-6 text-realtor-muted">
                Run bookings, calendars, pricing, integrations, and delivery.
              </span>
            </span>
            <span aria-hidden="true" className="text-xl text-realtor-primary transition group-hover:translate-x-1">
              →
            </span>
          </span>
        </Link>

        <Link
          href="/auth/sign-in?audience=realtor&next=/portal"
          className="group rounded-2xl border border-realtor-primary/15 bg-realtor-surface p-5 transition hover:border-realtor-primary/40 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-realtor-primary"
        >
          <span className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-lg font-semibold text-realtor-text">
                Realtor or agent
              </span>
              <span className="mt-1 block text-sm leading-6 text-realtor-muted">
                Book shoots, manage listings, and access delivered media.
              </span>
            </span>
            <span aria-hidden="true" className="text-xl text-realtor-primary transition group-hover:translate-x-1">
              →
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}

function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
    >
      {message}
    </p>
  );
}

function authErrorMessage(error: string | undefined): string | null {
  if (error === "expired") {
    return "That sign-in link expired. Request a new one after choosing your account type.";
  }
  if (error === "callback_failed") {
    return "Sign-in was cancelled or could not be completed. Choose your account type and try again.";
  }
  if (error === "invalid_invitation") {
    return "That company invitation is invalid. Ask the company administrator for a new invitation.";
  }
  if (error === "signup_disabled") {
    return "New photography companies are invitation-only during beta. Use the owner invitation sent to your email.";
  }
  return null;
}

function parseAudience(value: string | undefined): LoginAudience | null {
  return value === "company" || value === "realtor" ? value : null;
}
