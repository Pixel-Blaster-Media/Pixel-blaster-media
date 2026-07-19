import type { IntegrationJobType } from "./dispatcher-core";

const CANONICAL_ISO_PATTERN =
  /^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/;

export function integrationOutboxDispatchEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function parseDispatchWatermark(value: unknown): string {
  if (typeof value !== "string" || !CANONICAL_ISO_PATTERN.test(value)) {
    throw new Error("A canonical ISO watermark is required");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("A canonical ISO watermark is required");
  }
  return value;
}

export interface DueIntegrationJobIdentity {
  organizationId: string;
  bookingId: string;
  jobType: IntegrationJobType;
}

export interface DueIntegrationBooking {
  organizationId: string;
  bookingId: string;
  jobTypes: IntegrationJobType[];
}

export function groupDueIntegrationJobs(
  jobs: readonly DueIntegrationJobIdentity[],
): DueIntegrationBooking[] {
  const bookings = new Map<string, DueIntegrationBooking>();
  for (const job of jobs) {
    const key = `${job.organizationId}:${job.bookingId}`;
    const existing = bookings.get(key);
    if (existing) {
      if (!existing.jobTypes.includes(job.jobType)) {
        existing.jobTypes.push(job.jobType);
      }
      continue;
    }
    bookings.set(key, {
      organizationId: job.organizationId,
      bookingId: job.bookingId,
      jobTypes: [job.jobType],
    });
  }
  return Array.from(bookings.values());
}

export async function mapWithConcurrencyAndDeadline<T, R>(
  items: readonly T[],
  concurrency: number,
  deadlineAtMs: number,
  worker: (item: T) => Promise<R>,
): Promise<{ values: R[]; deadlineReached: boolean }> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error("Concurrency must be between 1 and 10");
  }
  if (!Number.isFinite(deadlineAtMs)) throw new Error("A finite deadline is required");

  let nextIndex = 0;
  let deadlineReached = false;
  const results: Array<{ index: number; value: R }> = [];
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        if (Date.now() >= deadlineAtMs) {
          deadlineReached = true;
          return;
        }
        const index = nextIndex;
        nextIndex += 1;
        results.push({ index, value: await worker(items[index]) });
      }
    },
  );
  await Promise.all(workers);
  return {
    values: results.sort((left, right) => left.index - right.index).map((entry) => entry.value),
    deadlineReached,
  };
}
