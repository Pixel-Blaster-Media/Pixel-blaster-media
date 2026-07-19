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
  const due = await listDueIntegrationJobs({
    limit: SCHEDULED_BATCH_SIZE,
    dispatchNotBefore: watermark,
  });
  if (due.outcome !== "listed") {
    throw new Error("Integration due-list lookup failed");
  }

  const distinctBookings = groupDueIntegrationJobs(due.jobs);
  const deadlineAtMs = Date.now() + SCHEDULED_DEADLINE_MS;
  const dispatched = await mapWithConcurrencyAndDeadline(
    distinctBookings,
    SCHEDULED_CONCURRENCY,
    deadlineAtMs,
    async (identity) => dispatchBookingIntegrationJobs({
      ...identity,
      workerId: buildIntegrationWorkerId("scheduled-outbox", randomUUID()),
      deadlineAtMs,
    }),
  );

  const outcomes: Record<string, number> = {};
  for (const bookingResults of dispatched.values) {
    for (const result of bookingResults) {
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    }
  }
  return {
    ok: true,
    listed: due.jobs.length,
    bookings: dispatched.values.length,
    outcomes,
    deadlineReached: dispatched.deadlineReached,
  };
}
