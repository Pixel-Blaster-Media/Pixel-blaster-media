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
    <div className="space-y-6">
      <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
        ✓ Sent
      </p>
      <h1 className="text-3xl font-bold text-realtor-text">Check your inbox</h1>
      <p className="text-realtor-muted">
        If an account exists for{" "}
        <span className="text-realtor-text">
          {params.email ?? "that email"}
        </span>
        , we sent a sign-in link. It expires in about an hour.
      </p>
      <p className="text-sm text-realtor-muted">
        Don't see it? Check spam, or email{" "}
        <a
          href="mailto:Info@PixelBlasterMedia.com"
          className="text-realtor-primary underline"
        >
          Info@PixelBlasterMedia.com
        </a>
        .
      </p>
    </div>
  );
}
