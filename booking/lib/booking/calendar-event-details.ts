import type { BookingGoogleCalendarEventInput } from "./calendar-event-sync.ts";

export type BookingCalendarSelectionKind =
  | "bundle"
  | "a_la_carte"
  | "addon";

export interface BookingCalendarSelectionItem {
  name: string;
  kind: BookingCalendarSelectionKind;
}

export interface BookingCalendarSelectionDetails {
  services: string[];
  addOns: string[];
  titleLabel: string;
  descriptionLines: string;
}

export interface BuildBookingGoogleCalendarEventInput {
  bookingId: string;
  organizationId: string;
  realtorName: string;
  realtorEmail?: string | null;
  realtorPhone?: string | null;
  brokerage?: string | null;
  items: readonly BookingCalendarSelectionItem[];
  street: string;
  location: string;
  startISO: string;
  endISO: string;
  notes?: string | null;
  additionalDetails?: readonly string[];
  attendee?: {
    email?: string | null;
    name?: string | null;
  } | null;
}

export function formatBookingCalendarSelections(
  items: readonly BookingCalendarSelectionItem[],
): BookingCalendarSelectionDetails {
  const services: string[] = [];
  const addOns: string[] = [];

  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;
    (item.kind === "addon" ? addOns : services).push(name);
  }

  return {
    services,
    addOns,
    titleLabel: [...services, ...addOns].join(", "),
    descriptionLines: [
      services.length ? `Services: ${services.join(", ")}` : null,
      addOns.length ? `Add-ons: ${addOns.join(", ")}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  };
}

export function buildBookingGoogleCalendarEventInput(
  args: BuildBookingGoogleCalendarEventInput,
): BookingGoogleCalendarEventInput {
  const selections = formatBookingCalendarSelections(args.items);
  const descriptionLines = [
    `Realtor: ${args.realtorName.trim()}`,
    args.realtorEmail?.trim()
      ? `Email: ${args.realtorEmail.trim()}`
      : null,
    args.realtorPhone?.trim()
      ? `Phone: ${args.realtorPhone.trim()}`
      : null,
    args.brokerage?.trim()
      ? `Brokerage: ${args.brokerage.trim()}`
      : null,
    selections.descriptionLines || null,
    ...(args.additionalDetails ?? []).filter((line) => line.trim()),
  ].filter((line): line is string => Boolean(line));

  let description = `${descriptionLines.join("\n")}\n`;
  if (args.notes) {
    description += `\nNotes:\n${args.notes}\n`;
  }

  const attendeeEmail = args.attendee?.email?.trim();
  const attendeeName = args.attendee?.name?.trim();

  return {
    bookingId: args.bookingId,
    organizationId: args.organizationId,
    summary: [args.realtorName, selections.titleLabel, args.street]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" - "),
    location: args.location,
    description,
    startISO: args.startISO,
    endISO: args.endISO,
    clearAttendees: !attendeeEmail,
    ...(attendeeEmail
      ? {
          attendeeEmail,
          ...(attendeeName ? { attendeeName } : {}),
        }
      : {}),
  };
}
