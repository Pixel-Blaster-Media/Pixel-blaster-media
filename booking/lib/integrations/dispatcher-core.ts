export const INTEGRATION_JOB_PHASES = [
  ["quickbooks.invoice.create"],
  ["google_calendar.event.create"],
  [
    "email.booking.confirmation",
    "email.admin.new_booking",
    "push.admin.new_booking",
  ],
] as const;

export type IntegrationJobType =
  (typeof INTEGRATION_JOB_PHASES)[number][number];

export type IntegrationWorkerKind =
  | "inline-public-booking"
  | "scheduled-outbox"
  | "admin-process-now";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildIntegrationWorkerId(
  kind: IntegrationWorkerKind,
  runId: string,
): string {
  if (!UUID_PATTERN.test(runId)) {
    throw new Error("Integration worker run id must be a valid UUID");
  }
  const workerId = `${kind}:${runId.toLowerCase()}`;
  if (workerId.length > 96) {
    throw new Error("Integration worker id exceeds the 96-character bound");
  }
  return workerId;
}

export async function runIntegrationDispatchSequence<T>(
  dispatchOne: (jobType: IntegrationJobType) => Promise<T>,
  requestedJobTypes: readonly IntegrationJobType[] = INTEGRATION_JOB_PHASES.flat(),
): Promise<T[]> {
  const requested = new Set(requestedJobTypes);
  const results: T[] = [];
  for (const phase of INTEGRATION_JOB_PHASES) {
    const current = phase.filter((jobType) => requested.has(jobType));
    if (current.length === 0) continue;
    results.push(...await Promise.all(current.map(dispatchOne)));
  }
  return results;
}

export class ProviderMutationTimeoutError extends Error {
  readonly jobType: IntegrationJobType;
  readonly timeoutMs: number;

  constructor(
    jobType: IntegrationJobType,
    timeoutMs: number,
  ) {
    super(`Provider mutation timed out for ${jobType}`);
    this.name = "ProviderMutationTimeoutError";
    this.jobType = jobType;
    this.timeoutMs = timeoutMs;
  }
}

export async function withProviderMutationTimeout<T>(
  mutation: Promise<T>,
  timeoutMs: number,
  jobType: IntegrationJobType,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("Provider mutation timeout must be between 1 and 60000ms");
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      mutation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new ProviderMutationTimeoutError(jobType, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
