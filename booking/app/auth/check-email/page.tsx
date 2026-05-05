import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Check your email",
};

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-6 py-8">
      <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
        ✓ Sent
      </p>
      <h1 className="text-3xl font-bold text-white">Check your inbox</h1>
      <p className="text-ink-muted">
        If an account exists for{" "}
        <span className="text-white">
          {params.email ?? "that email"}
        </span>
        , we sent a sign-in link. It expires in about an hour.
      </p>
      <p className="text-sm text-ink-muted">
        Don't see it? Check spam, or email{" "}
        <a
          href="mailto:Info@PixelBlasterMedia.com"
          className="text-brand-light underline"
        >
          Info@PixelBlasterMedia.com
        </a>
        .
      </p>
    </div>
  );
}
