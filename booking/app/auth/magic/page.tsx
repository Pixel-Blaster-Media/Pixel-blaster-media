import Link from "next/link";

import {
  buildLoginContinuationPath,
  safePostAuthPath,
  type LoginAudience,
} from "@/lib/auth/account-destination";

import SignInForm from "../sign-in/SignInForm";

export default async function MagicLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string; next?: string }>;
}) {
  const params = await searchParams;
  const audience: LoginAudience =
    params.audience === "realtor" ? "realtor" : "company";
  const continuation = params.next
    ? safePostAuthPath(params.next)
    : buildLoginContinuationPath(audience, null);
  const backParams = new URLSearchParams({
    audience,
    next: continuation,
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-realtor-primary">
          {audience === "company" ? "Photography company" : "Realtor or agent"}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-realtor-text">
          Email me a sign-in link
        </h1>
        <p className="mt-2 text-sm leading-6 text-realtor-muted">
          Enter the email already linked to your workspace. Unknown emails do
          not create accounts.
        </p>
      </header>
      <SignInForm next={continuation} />
      <p className="text-xs text-realtor-muted">
        Prefer your password?{" "}
        <Link
          href={`/auth/sign-in?${backParams.toString()}`}
          className="font-semibold text-realtor-primary underline"
        >
          Return to login
        </Link>
        .
      </p>
    </div>
  );
}
