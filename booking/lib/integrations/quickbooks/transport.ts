export type QBMutationOutcome = "rejected" | "unknown" | "confirmed";

export class QBOError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    // Retained for compatibility; never retain raw provider bodies/PII.
    public readonly body: string = "",
    public readonly outcome: "rejected" | "unknown" = "unknown",
  ) { super(message); }
}

export interface QBORequestInit {
  method?: "GET" | "POST" | "PUT";
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}

export function createQBOTransport(config: { base: string; realmId: string; accessToken: string }) {
  return async function request<T = unknown>(path: string, init: QBORequestInit = {}): Promise<T> {
    const query = new URLSearchParams({ minorversion: "70", ...init.query });
    const url = `${config.base}/v3/company/${encodeURIComponent(config.realmId)}${path}?${query}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${config.accessToken}` },
        body: init.body ? JSON.stringify(init.body) : undefined,
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25_000),
      });
    } catch { throw new QBOError("QuickBooks transport outcome unknown.", 0); }
    let data: { Fault?: { type?: string; Error?: Array<{ code?: string }> } };
    try { data = await res.json(); }
    catch { throw new QBOError("QuickBooks response unreadable.", res.status); }
    if (!res.ok || data?.Fault) {
      // Duplicate request ID (600) may describe a previous accepted mutation.
      // Only a documented validation/authentication fault proves rejection.
      const fault = data?.Fault;
      const rejected = [200, 400].includes(res.status) && fault?.type === "ValidationFault" &&
        Array.isArray(fault.Error) && fault.Error.length > 0 &&
        // Deliberately narrow: documented invalid-property/missing-param/ID.
        // All other codes (including future codes) require reconciliation.
        fault.Error.every(e => e && ["2010", "2020", "2030"].includes(e.code ?? ""));
      throw new QBOError("QuickBooks request failed.", res.status, "", rejected ? "rejected" : "unknown");
    }
    return data as T;
  };
}
