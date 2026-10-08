export type CatalogVideoCompletion =
  | { status: "ready" }
  | { status: "cancelled" }
  | { status: "pending" | "blocked" | "failed"; message: string };

const VERIFYING = "Video verification is temporarily unavailable. Checking again shortly…";
const PENDING = "Video verification is still pending. Use Check processing again shortly; you do not need to upload the video again.";
const PROCESSING = "Cloudflare is still processing the video. You can close this view and check again later.";
const MAX_CHECKS = 40;
const MAX_TRANSIENT_FAILURES = 3;
const MAX_WAIT_MS = 120_000;

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Only checks/finalizes an existing example. Never prepares or transfers a video. */
export async function waitForCatalogVideoCompletion(
  exampleId: string,
  options: {
    signal: AbortSignal;
    onPending: (message: string) => void;
    fetchImpl?: typeof fetch;
    now?: () => number;
    sleep?: typeof pause;
  },
): Promise<CatalogVideoCompletion> {
  const { signal, onPending, fetchImpl = fetch, now = Date.now, sleep = pause } = options;
  const deadline = now() + MAX_WAIT_MS;
  let transientFailures = 0;
  let pendingMessage = PENDING;
  for (let attempt = 0; attempt < MAX_CHECKS && now() < deadline; attempt += 1) {
    if (signal.aborted) return { status: "cancelled" };
    let processing = false;
    const request = new AbortController();
    const abortRequest = () => request.abort();
    signal.addEventListener("abort", abortRequest, { once: true });
    const timeout = setTimeout(abortRequest, Math.max(1, Math.min(15_000, deadline - now())));
    try {
      const response = await fetchImpl(`/api/admin/catalog-examples/${encodeURIComponent(exampleId)}/complete`, {
        method: "POST", redirect: "error", cache: "no-store",
        signal: request.signal,
      });
      let body: Record<string, unknown> = {};
      try {
        const value: unknown = await response.json();
        if (value && typeof value === "object" && !Array.isArray(value)) body = value as Record<string, unknown>;
      } catch { /* A proxy/auth HTML response is an unconfirmed check, not a failed video. */ }
      if (signal.aborted) return { status: "cancelled" };
      // A permission denial always stops, even if an unexpected body says retryable.
      if (response.status === 401 || response.status === 403) {
        return { status: "blocked", message: response.status === 401
          ? "Sign in again, then check this video's status. You do not need to upload it again."
          : "You do not have permission to check this video." };
      }
      if (response.ok && body.ok === true && body.status === "ready") return { status: "ready" };
      if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
        return { status: "failed", message: typeof body.error === "string"
          ? body.error : "Could not confirm this video. Close this view and review the existing example." };
      }
      processing = response.status === 202 && body.status === "processing";
    } catch {
      if (signal.aborted) return { status: "cancelled" };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortRequest);
    }
    transientFailures = processing ? 0 : transientFailures + 1;
    pendingMessage = processing ? PROCESSING : PENDING;
    onPending(processing ? PROCESSING : VERIFYING);
    if (transientFailures >= MAX_TRANSIENT_FAILURES) break;
    const remaining = deadline - now();
    if (remaining <= 0 || attempt + 1 === MAX_CHECKS) break;
    await sleep(Math.min(3000, remaining), signal);
  }
  return signal.aborted ? { status: "cancelled" } : { status: "pending", message: pendingMessage };
}
