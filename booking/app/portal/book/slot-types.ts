export interface DisplaySlot {
  /** ISO UTC string — what we round-trip through the URL / form. */
  start: string;
  /** "9:00 AM" — displayed to the realtor in BUSINESS_TZ. */
  timeLabel: string;
}

export interface SlotsByDay {
  /** "Monday, Apr 15" — displayed as the group header. */
  dateLabel: string;
  slots: DisplaySlot[];
}

export const BUSINESS_TZ_DISPLAY = "Eastern Time (Hamilton / Toronto)";
