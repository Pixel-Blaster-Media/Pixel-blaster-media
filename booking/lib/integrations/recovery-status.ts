import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

type Metric = { status: "known" | "unknown"; count: number | null; oldestAgeSeconds: number | null };
const unknown: Metric = { status: "unknown", count: null, oldestAgeSeconds: null };

/** Read-only cron/operator snapshot, deliberately independent of provider dispatch.
 * created_at measures total unresolved age; media updated_at rotates on polling,
 * so it cannot truthfully measure time since progress. No automatic stall verdict.
 */
export async function recoveryStatus(
  request: Request,
  secret: string | undefined,
  loadClient: () => SupabaseClient<Database>,
  now = Date.now(),
): Promise<Response> {
  const respond = (body: unknown, status: number) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (!secret) return respond({ ok: false, error: "Recovery status unavailable" }, 503);
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return respond({ ok: false, error: "Unauthorized" }, 401);
  }
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
    return respond({ ok: false, error: "A tenant UUID is required" }, 400);
  }
  // Fixed three queries, at most one timestamp each, shared transport deadline.
  // Exact counts may scan matching rows; a timeout is unknown, never healthy zero.
  const signal = AbortSignal.timeout(3_000);
  const read = async (table: "integration_jobs" | "autoenhance_batches", states: string[]): Promise<Metric> => {
    try {
      const { data, count, error } = await loadClient().from(table)
        .select("created_at", { count: "exact" })
        .eq("organization_id", organizationId).in("status", states)
        .order("created_at", { ascending: true }).limit(1).abortSignal(signal);
      if (error || !Number.isSafeInteger(count) || count === null || count < 0 || !Array.isArray(data)) return unknown;
      if (count === 0) return data.length === 0 ? { status: "known", count: 0, oldestAgeSeconds: null } : unknown;
      const oldest = Date.parse(data[0]?.created_at ?? "");
      if (!Number.isFinite(oldest) || !Number.isFinite(now) || oldest > now) return unknown;
      return { status: "known", count, oldestAgeSeconds: Math.floor((now - oldest) / 1_000) };
    } catch {
      return unknown;
    }
  };
  const [outboxUnresolved, outboxManual, mediaUnresolved] = await Promise.all([
    read("integration_jobs", ["pending", "retryable", "processing"]),
    read("integration_jobs", ["dead_letter"]),
    read("autoenhance_batches", ["processing", "waiting_for_iguide", "attention"]),
  ]);
  const metrics = { outboxUnresolved, outboxManual, mediaUnresolved };
  const ok = Object.values(metrics).every((metric) => metric.status === "known");
  return respond({ ok, metrics }, ok ? 200 : 503);
}