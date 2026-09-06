import "server-only";

import { randomUUID } from "node:crypto";

import { dispatchBookingIntegrationJobs } from "./dispatcher";
import { buildIntegrationWorkerId } from "./dispatcher-core";
import { listDueIntegrationJobs } from "./jobs";
import {
  groupDueIntegrationJobs,
  mapWithConcurrencyAndDeadline,
  parseDispatchWatermark,
} from "./scheduler-core";

const SCHEDULED_BATCH_SIZE = 5;
const SCHEDULED_CONCURRENCY = 2;
const SCHEDULED_DEADLINE_MS = 45_000;

export interface ScheduledIntegrationOutboxResult {
  ok: true;
  listed: number;
  bookings: number;
  outcomes: Record<string, number>;
  deadlineReached: boolean;
}

export async function runScheduledIntegrationOutbox({
  dispatchNotBefore,
}: {
  dispatchNotBefore: string;
}): Promise<ScheduledIntegrationOutboxResult> {
  const watermark = parseDispatchWatermark(dispatchNotBefore);
  const deadlineAtMs = Date.now() + SCHEDULED_DEADLINE_MS;
  const seen = new Set<string>();
  const outcomes: Record<string, number> = {};
  let listed = 0;
  let bookings = 0;
  let deadlineReached = false;
  // Re-list after settlement so dependency phases can advance in one invocation.
  // Hard cap: three pages of five identities, sharing ONE provider deadline.
  for (let page = 0; page < 3; page++) {
    if (Date.now() >= deadlineAtMs) { deadlineReached = true; break; }
    const due = await listDueIntegrationJobs({ limit: SCHEDULED_BATCH_SIZE, dispatchNotBefore: watermark });
    if (due.outcome !== "listed") throw new Error("Integration due-list lookup failed");
    const fresh = due.jobs.filter((job) => {
      const key = `${job.organizationId}:${job.bookingId}:${job.jobType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!fresh.length) break;
    listed += fresh.length;
    const dispatched = await mapWithConcurrencyAndDeadline(
      groupDueIntegrationJobs(fresh), SCHEDULED_CONCURRENCY, deadlineAtMs,
      async (identity) => dispatchBookingIntegrationJobs({
        ...identity, workerId: buildIntegrationWorkerId("scheduled-outbox", randomUUID()), deadlineAtMs,
      }),
    );
    bookings += dispatched.values.length;
    for (const results of dispatched.values) for (const result of results) {
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    }
    if (dispatched.deadlineReached) { deadlineReached = true; break; }
  }
  return { ok: true, listed, bookings, outcomes, deadlineReached };
}
