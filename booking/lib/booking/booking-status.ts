import type {
  BookingRequestStatus,
  BookingStatus,
  DeliverableType,
} from "@/lib/supabase/database.types";

/**
 * Visual + state-machine helpers for booking statuses.
 *
 * Kept here (not in the React tree) so server actions can reuse the same
 * "what transitions are allowed" logic that the UI relies on for showing
 * buttons.
 */

interface StatusMeta {
  label: string;
  /** Tailwind classes for a colored chip. */
  pill: string;
}

export const BOOKING_STATUSES: Record<BookingStatus, StatusMeta> = {
  requested: {
    label: "Requested",
    pill: "border-white/20 bg-white/5 text-white/80",
  },
  confirmed: {
    label: "Confirmed",
    pill: "border-brand/40 bg-brand/15 text-brand-light",
  },
  shot: {
    label: "Shot",
    pill: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  },
  editing: {
    label: "Editing",
    pill: "border-purple-400/40 bg-purple-400/10 text-purple-200",
  },
  delivered: {
    label: "Delivered",
    pill: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  },
  cancelled: {
    label: "Cancelled",
    pill: "border-red-400/40 bg-red-400/10 text-red-200",
  },
};

/**
 * Allowed forward transitions. `cancelled` can be reached from any open
 * status; `delivered` is terminal.
 */
const FORWARD: Record<BookingStatus, BookingStatus[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["shot", "cancelled"],
  shot: ["editing", "cancelled"],
  editing: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function nextBookingStatuses(current: BookingStatus): BookingStatus[] {
  return FORWARD[current] ?? [];
}

/**
 * Statuses a booking can be user-cancelled from. Once work has started
 * (`shot` / `editing`) or the deliverables have been handed over
 * (`delivered`), the Cancel button hides — admin can still move the
 * status manually via the pipeline if they need to record something
 * unusual.
 *
 * Client-safe (no server-only deps) so it can be checked in client
 * components for conditional rendering.
 */
const CANCELLABLE_STATUSES: BookingStatus[] = ["requested", "confirmed"];

export function isCancellable(status: BookingStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

export const BOOKING_REQUEST_STATUSES: Record<BookingRequestStatus, StatusMeta> = {
  new: {
    label: "New",
    pill: "border-brand-light/40 bg-brand/15 text-brand-light",
  },
  reviewing: {
    label: "Reviewing",
    pill: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  },
  accepted: {
    label: "Accepted",
    pill: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  },
  declined: {
    label: "Declined",
    pill: "border-red-400/40 bg-red-400/10 text-red-200",
  },
};

export const DELIVERABLE_TYPES: { id: DeliverableType; label: string }[] = [
  { id: "photo_gallery", label: "Photo gallery" },
  { id: "virtual_tour", label: "Virtual tour" },
  { id: "floor_plan", label: "Floor plan" },
  { id: "video", label: "Video" },
  { id: "aerial", label: "Aerial / drone" },
];

export function deliverableTypeLabel(t: DeliverableType): string {
  return DELIVERABLE_TYPES.find((d) => d.id === t)?.label ?? t;
}
