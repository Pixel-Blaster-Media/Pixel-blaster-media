import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";

import FotelloTestClient from "./FotelloTestClient";

export const dynamic = "force-dynamic";

export default async function FotelloTestPage() {
  await requireAdmin();
  if (process.env.ENABLE_FOTELLO_TEST !== "1") notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-realtor-primary">
            Admin tool
          </p>
          <h1 className="mt-1 text-2xl font-bold text-realtor-text">Fotello API test</h1>
          <p className="mt-1 max-w-2xl text-sm text-realtor-muted">
            Use this page to test Fotello directly: create a listing, upload image files to Fotello's presigned URLs, create an enhance, then poll getEnhance until a completed URL appears.
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-full border border-realtor-primary/20 bg-white px-3 py-1.5 text-xs text-realtor-primary transition hover:border-realtor-primary/40 hover:bg-realtor-primary/5"
        >
          Admin home
        </Link>
      </div>
      <FotelloTestClient />
    </div>
  );
}
