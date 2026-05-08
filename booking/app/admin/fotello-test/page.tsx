import Link from "next/link";

import { requireAdmin } from "@/lib/auth/require-admin";

import FotelloTestClient from "./FotelloTestClient";

export const dynamic = "force-dynamic";

export default async function FotelloTestPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-light">
            Admin tool
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">Fotello API test</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Use this page to test Fotello directly: create a listing, upload image files to Fotello's presigned URLs, create an enhance, then poll getEnhance until a completed URL appears.
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-ink-muted transition hover:border-white/30 hover:text-white"
        >
          Admin home
        </Link>
      </div>
      <FotelloTestClient />
    </div>
  );
}
