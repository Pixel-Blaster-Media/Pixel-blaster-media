import { redirect } from "next/navigation";

export default async function LegacyPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const audience = next?.startsWith("/portal") ? "realtor" : "company";
  const destination = new URLSearchParams({
    audience,
    next: next ?? (audience === "realtor" ? "/portal" : "/admin"),
  });
  redirect(`/auth/sign-in?${destination.toString()}`);
}
