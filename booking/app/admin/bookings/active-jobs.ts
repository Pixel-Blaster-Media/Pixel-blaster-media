import type { BookingStatus } from "@/lib/supabase/database.types";

export const ACTIVE_JOB_STATUSES: BookingStatus[] = [
  "requested",
  "confirmed",
  "shot",
  "editing",
];

interface ActiveJobLike {
  status: BookingStatus;
  scheduled_at: string | null;
}

/**
 * Jobs is the production pipeline, not a second calendar. Keep every unresolved
 * active status visible and place unscheduled requests first so they cannot be
 * lost behind dated work.
 */
export function prioritizeActiveJobs<T extends ActiveJobLike>(jobs: T[]): T[] {
  return jobs
    .filter((job) => ACTIVE_JOB_STATUSES.includes(job.status))
    .sort(
      (a, b) =>
        Number(!(a.status === "requested" && !a.scheduled_at)) -
        Number(!(b.status === "requested" && !b.scheduled_at)),
    );
}
