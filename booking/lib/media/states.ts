import {
  INGEST_STATES,
  RELEASE_STATES,
  type IngestState,
  type ReleaseState,
} from "./types.ts";

function freezeTransitionMap<State extends string>(
  transitions: Record<State, readonly State[]>,
): Readonly<Record<State, readonly State[]>> {
  for (const allowed of Object.values(transitions)) Object.freeze(allowed);
  return Object.freeze(transitions);
}

export const ingestTransitions = freezeTransitionMap<IngestState>({
  discovered: ["url_ready", "rejected", "dead_letter"],
  url_ready: ["fetching", "source_expired", "rejected", "dead_letter"],
  fetching: ["quarantined", "retryable", "source_expired", "reconciliation_required", "rejected", "dead_letter"],
  quarantined: ["validating", "rejected", "dead_letter"],
  validating: ["scanning", "rejected", "dead_letter"],
  scanning: ["accepted", "retryable", "reconciliation_required", "rejected", "dead_letter"],
  accepted: ["deriving", "review_pending", "reconciliation_required"],
  deriving: ["review_pending", "retryable", "reconciliation_required", "dead_letter"],
  review_pending: [],
  retryable: ["fetching", "validating", "scanning", "deriving", "reconciliation_required", "dead_letter"],
  source_expired: ["url_ready", "rejected", "dead_letter"],
  reconciliation_required: ["fetching", "quarantined", "validating", "scanning", "deriving", "review_pending", "rejected", "dead_letter"],
  rejected: [],
  dead_letter: [],
} satisfies Record<IngestState, readonly IngestState[]>);

export const releaseTransitions = freezeTransitionMap<ReleaseState>({
  draft: ["review_pending", "withdrawn"],
  review_pending: ["changes_requested", "approved", "withdrawn"],
  changes_requested: ["revision_processing", "withdrawn"],
  revision_processing: ["review_pending", "changes_requested", "withdrawn"],
  approved: ["packaging", "withdrawn"],
  packaging: ["ready", "withdrawn"],
  ready: ["published", "superseded", "withdrawn"],
  published: ["superseded", "withdrawn"],
  superseded: [],
  withdrawn: [],
} satisfies Record<ReleaseState, readonly ReleaseState[]>);

const ingestStateSet = new Set<string>(INGEST_STATES);
const releaseStateSet = new Set<string>(RELEASE_STATES);

export function isIngestState(value: unknown): value is IngestState {
  return typeof value === "string" && ingestStateSet.has(value);
}

export function isReleaseState(value: unknown): value is ReleaseState {
  return typeof value === "string" && releaseStateSet.has(value);
}

export function canTransitionIngest(from: unknown, to: unknown): boolean {
  return isIngestState(from) && isIngestState(to)
    && (ingestTransitions[from] as readonly IngestState[]).includes(to);
}

export function canTransitionRelease(from: unknown, to: unknown): boolean {
  return isReleaseState(from) && isReleaseState(to)
    && (releaseTransitions[from] as readonly ReleaseState[]).includes(to);
}
