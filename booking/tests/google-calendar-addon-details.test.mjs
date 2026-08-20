import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import ts from "typescript";
import { tsImport } from "tsx/esm/api";

const importedDetailsModule = await tsImport(
  "../lib/booking/calendar-event-details.ts",
  import.meta.url,
);
const {
  buildBookingGoogleCalendarEventInput,
  formatBookingCalendarSelections,
} = importedDetailsModule.default;

test("calendar event titles and descriptions keep add-ons visible and separate", () => {
  assert.deepEqual(
    formatBookingCalendarSelections([
      { name: "The Blue Print", kind: "bundle" },
      { name: " Aerial Add-on ", kind: "addon" },
    ]),
    {
      services: ["The Blue Print"],
      addOns: ["Aerial Add-on"],
      titleLabel: "The Blue Print, Aerial Add-on",
      descriptionLines:
        "Services: The Blue Print\nAdd-ons: Aerial Add-on",
    },
  );
});

test("the shared builder produces the actual add-on-aware provider payload", () => {
  assert.equal(typeof buildBookingGoogleCalendarEventInput, "function");
  assert.deepEqual(
    buildBookingGoogleCalendarEventInput({
      bookingId: "22222222-2222-4222-8222-222222222222",
      organizationId: "11111111-1111-4111-8111-111111111111",
      realtorName: "Cindy Cloutier",
      realtorEmail: "cindy@example.com",
      realtorPhone: "555-0100",
      brokerage: "Example Realty",
      items: [
        { name: "The Blue Print", kind: "bundle" },
        { name: "Aerial Add-on", kind: "addon" },
      ],
      street: "4854 Haldimand Road 20",
      location: "4854 Haldimand Road 20, Dunnville, N1A 2W3",
      notes: "Photograph the detached garage.",
      additionalDetails: ["Size: ~2500 sqft", "Occupancy: Vacant"],
      startISO: "2026-08-26T15:00:00.000Z",
      endISO: "2026-08-26T16:50:00.000Z",
      attendee: {
        email: "cindy@example.com",
        name: "Cindy Cloutier",
      },
    }),
    {
      bookingId: "22222222-2222-4222-8222-222222222222",
      organizationId: "11111111-1111-4111-8111-111111111111",
      summary:
        "Cindy Cloutier - The Blue Print, Aerial Add-on - 4854 Haldimand Road 20",
      location: "4854 Haldimand Road 20, Dunnville, N1A 2W3",
      description:
        "Realtor: Cindy Cloutier\n" +
        "Email: cindy@example.com\n" +
        "Phone: 555-0100\n" +
        "Brokerage: Example Realty\n" +
        "Services: The Blue Print\n" +
        "Add-ons: Aerial Add-on\n" +
        "Size: ~2500 sqft\n" +
        "Occupancy: Vacant\n\n" +
        "Notes:\nPhotograph the detached garage.\n",
      startISO: "2026-08-26T15:00:00.000Z",
      endISO: "2026-08-26T16:50:00.000Z",
      clearAttendees: false,
      attendeeEmail: "cindy@example.com",
      attendeeName: "Cindy Cloutier",
    },
  );
});

test("service-only bookings omit the add-on line without losing service metadata", () => {
  assert.deepEqual(
    formatBookingCalendarSelections([
      { name: "The Essential", kind: "bundle" },
      { name: "Twilight Photos", kind: "a_la_carte" },
    ]),
    {
      services: ["The Essential", "Twilight Photos"],
      addOns: [],
      titleLabel: "The Essential, Twilight Photos",
      descriptionLines: "Services: The Essential, Twilight Photos",
    },
  );
});

test("quiet events omit attendee fields without omitting add-ons", () => {
  const event = buildBookingGoogleCalendarEventInput({
    bookingId: "22222222-2222-4222-8222-222222222222",
    organizationId: "11111111-1111-4111-8111-111111111111",
    realtorName: "Realtor",
    items: [{ name: "Site Plan", kind: "addon" }],
    street: "1 Main Street",
    location: "1 Main Street",
    startISO: "2026-08-26T15:00:00.000Z",
    endISO: "2026-08-26T15:20:00.000Z",
  });
  assert.equal(event.summary, "Realtor - Site Plan - 1 Main Street");
  assert.equal(event.description, "Realtor: Realtor\nAdd-ons: Site Plan\n");
  assert.equal("attendeeEmail" in event, false);
  assert.equal("attendeeName" in event, false);
  assert.equal(event.clearAttendees, true);
});

const bookingRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const googleClientSource = readFileSync(
  join(bookingRoot, "lib/integrations/google-calendar/client.ts"),
  "utf8",
);

test("the booking Calendar client exposes no partial time-only mutation bypass", () => {
  assert.doesNotMatch(googleClientSource, /updateEventTime|patchEventTime/);
});

function productionSourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionSourceFiles(path));
    } else if ([".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

function realCallCounts(names) {
  const counts = new Map();
  for (const sourceRoot of [join(bookingRoot, "app"), join(bookingRoot, "lib")]) {
    for (const path of productionSourceFiles(sourceRoot)) {
      const source = readFileSync(path, "utf8");
      const sourceFile = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node) => {
        if (ts.isCallExpression(node)) {
          const expression = node.expression;
          const name = ts.isIdentifier(expression)
            ? expression.text
            : ts.isPropertyAccessExpression(expression)
              ? expression.name.text
              : null;
          if (name && names.has(name)) {
            const key = `${relative(bookingRoot, path)}#${name}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

test("AST inventory classifies every real Calendar event mutation", () => {
  assert.deepEqual(
    realCallCounts(new Set(["createEvent", "updateEvent", "updateEventTime"])),
    {
      "app/admin/settings/integrations/actions.ts#createEvent": 1,
      "lib/booking/calendar-event-sync.ts#createEvent": 1,
      "lib/booking/calendar-event-sync.ts#updateEvent": 1,
    },
  );
});

test("AST inventory classifies every destructive Calendar event mutation", () => {
  assert.deepEqual(realCallCounts(new Set(["deleteEvent"])), {
    "lib/booking/calendar-event-service.ts#deleteEvent": 1,
    "lib/booking/calendar-event-sync.ts#deleteEvent": 1,
  });
});

test("the canonical projection alone builds booking provider payloads", () => {
  assert.deepEqual(realCallCounts(new Set(["buildBookingGoogleCalendarEventInput"])), {
    "lib/booking/calendar-event-projection-core.ts#buildBookingGoogleCalendarEventInput": 1,
  });
});

test("every stored-booking writer uses the convergent canonical service", () => {
  assert.deepEqual(
    realCallCounts(new Set(["syncStoredBookingGoogleCalendarEvent"])),
    {
      "app/admin/bookings/[id]/actions.ts#syncStoredBookingGoogleCalendarEvent": 1,
      "app/admin/calendar/actions.ts#syncStoredBookingGoogleCalendarEvent": 2,
      "app/admin/inbox/[id]/actions.ts#syncStoredBookingGoogleCalendarEvent": 1,
      "app/book/manage/[token]/actions.ts#syncStoredBookingGoogleCalendarEvent": 1,
      "lib/booking/cancel.ts#syncStoredBookingGoogleCalendarEvent": 1,
      "lib/booking/realtor-calendar-fanout.ts#syncStoredBookingGoogleCalendarEvent": 1,
      "lib/integrations/dispatcher.ts#syncStoredBookingGoogleCalendarEvent": 1,
    },
  );
});

test("the canonical service alone reloads snapshots and owns compensated sync", () => {
  assert.deepEqual(realCallCounts(new Set([
    "loadBookingCalendarSelectionItems",
    "syncBookingGoogleCalendarEvent",
  ])), {
    "lib/booking/calendar-event-service-core.ts#syncBookingGoogleCalendarEvent": 1,
    "lib/booking/calendar-event-service.ts#loadBookingCalendarSelectionItems": 1,
  });
});
