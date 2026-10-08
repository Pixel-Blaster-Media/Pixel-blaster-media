import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getServiceSupabase } from "@/lib/supabase/server";
import { validCatalogUploadSize, validUploadFingerprint } from "@/lib/booking/catalog-upload-policy";
import { PREPARATION_CHECK_OPERATION, PREPARATION_CHECK_SOURCE } from "@/lib/booking/catalog-preparation-check";
import PreparationCheck from "./PreparationCheck";

export const metadata: Metadata = { title: "Upload preparation check", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PreparationCheckPage({ searchParams }: { searchParams: Promise<{ title?: string }> }) {
  const admin = await requireAdmin();
  const { title } = await searchParams;
  if (typeof title !== "string" || !title.trim() || title.trim().length > 120) notFound();
  const db = getServiceSupabase();
  const [source, operation] = await Promise.all([
    db.from("catalog_stream_upload_claims").select("catalog_item_id, upload_size, upload_fingerprint, state")
      .eq("id", PREPARATION_CHECK_SOURCE).eq("organization_id", admin.organizationId).eq("upload_protocol", "tus").maybeSingle(),
    db.from("catalog_stream_upload_claims").select("id")
      .eq("id", PREPARATION_CHECK_OPERATION).eq("organization_id", admin.organizationId).maybeSingle(),
  ]);
  if (!source.error && !source.data) notFound();
  const available = !source.error && !operation.error && source.data?.state === "cleaned"
    && typeof source.data.catalog_item_id === "string"
    && validCatalogUploadSize(source.data.upload_size) && validUploadFingerprint(source.data.upload_fingerprint);
  return <section className="mx-auto max-w-2xl space-y-6">
    <Link href="/admin/settings/pricing" className="text-sm font-semibold text-realtor-primary">← Services & pricing</Link>
    <header>
      <h1 className="text-3xl font-semibold text-realtor-text">Upload preparation check</h1>
      <p className="mt-3 text-sm leading-6 text-realtor-muted">Run the newly approved test after the upload preparation repair. The previous test remains closed. This checks whether Cloudflare can prepare the upload and keeps the result for review.</p>
    </header>
    {available && source.data ? <PreparationCheck title={title.trim()} catalogItemId={source.data.catalog_item_id!}
      size={source.data.upload_size!} fingerprint={source.data.upload_fingerprint!} alreadyAttempted={Boolean(operation.data)} />
      : <p role="alert" className="rounded-2xl border border-realtor-primary/15 bg-realtor-surface p-5 text-sm">This test is unavailable because the previous operation needs review. No preparation request has been sent.</p>}
  </section>;
}
