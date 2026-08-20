import type {
  BookingCalendarSelectionItem,
  BookingCalendarSelectionKind,
} from "@/lib/booking/calendar-event-details";

export interface BookingCalendarSelectionSnapshot {
  item_name: string;
  item_slug: string;
  item_kind: string;
}

export interface BookingCalendarCatalogLabel {
  slug: string;
  name: string;
  kind: string;
}

export interface BookingCalendarSelectionLoaderDependencies {
  verifyBooking(args: {
    organizationId: string;
    bookingId: string;
  }): Promise<boolean>;
  loadSnapshots(bookingId: string): Promise<BookingCalendarSelectionSnapshot[]>;
  loadCatalog(organizationId: string): Promise<BookingCalendarCatalogLabel[]>;
  legacyLabel(slug: string, kind: "service" | "addon"): string;
  legacyServiceKind(slug: string): "bundle" | "a_la_carte";
}

export async function loadBookingCalendarSelectionItemsCore(
  {
    organizationId,
    bookingId,
    services,
    addOns,
  }: {
    organizationId: string;
    bookingId: string;
    services: readonly string[];
    addOns: readonly string[];
  },
  dependencies: BookingCalendarSelectionLoaderDependencies,
): Promise<BookingCalendarSelectionItem[]> {
  let verified = false;
  try {
    verified = await dependencies.verifyBooking({ organizationId, bookingId });
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new Error("Could not verify booking calendar selections");
  }

  const serviceSlugs = normalizeSelectionSlugs(services);
  const addOnSlugs = normalizeSelectionSlugs(addOns);
  if (
    new Set([...serviceSlugs, ...addOnSlugs]).size !==
    serviceSlugs.length + addOnSlugs.length
  ) {
    throw new Error("Booking calendar selections are inconsistent");
  }

  // Current booking arrays own membership. Snapshots own historical labels and
  // kinds only when a unique, valid row still matches that current membership.
  const expectedKinds = new Map<string, "service" | "addon">([
    ...serviceSlugs.map((slug) => [slug, "service"] as const),
    ...addOnSlugs.map((slug) => [slug, "addon"] as const),
  ]);
  const snapshots = await dependencies.loadSnapshots(bookingId);
  const snapshotBySlug = new Map<string, BookingCalendarSelectionItem>();
  const ambiguousSlugs = new Set<string>();

  for (const snapshot of snapshots) {
    const slug = typeof snapshot.item_slug === "string"
      ? snapshot.item_slug.trim()
      : "";
    const name = typeof snapshot.item_name === "string"
      ? snapshot.item_name.trim()
      : "";
    const expectedKind = expectedKinds.get(slug);

    // Stale rows are ignored; current arrays decide what remains selected.
    if (!expectedKind) continue;
    const kindMatches =
      isSelectionKind(snapshot.item_kind) &&
      (expectedKind === "addon"
        ? snapshot.item_kind === "addon"
        : snapshot.item_kind !== "addon");
    if (!slug || !name || !kindMatches || snapshotBySlug.has(slug)) {
      ambiguousSlugs.add(slug);
      snapshotBySlug.delete(slug);
      continue;
    }
    if (!ambiguousSlugs.has(slug)) {
      snapshotBySlug.set(slug, {
        name,
        kind: snapshot.item_kind as BookingCalendarSelectionKind,
      });
    }
  }

  const needsCatalog = [...expectedKinds.keys()].some(
    (slug) => !snapshotBySlug.has(slug),
  );
  let catalog: BookingCalendarCatalogLabel[] = [];
  if (needsCatalog) {
    try {
      catalog = await dependencies.loadCatalog(organizationId);
    } catch {
      catalog = [];
    }
  }
  const catalogBySlug = new Map(
    catalog
      .filter(
        (item) =>
          typeof item.slug === "string" &&
          item.slug.trim().length > 0 &&
          typeof item.name === "string" &&
          item.name.trim().length > 0,
      )
      .map((item) => [item.slug.trim(), item]),
  );

  const fallbackName = (slug: string, kind: "service" | "addon") => {
    const catalogItem = catalogBySlug.get(slug);
    const catalogKindMatches = kind === "addon"
      ? catalogItem?.kind === "addon"
      : catalogItem?.kind === "bundle" || catalogItem?.kind === "a_la_carte";
    const catalogName = catalogKindMatches ? catalogItem?.name.trim() : null;
    if (catalogName) return catalogName;
    const legacyName = dependencies.legacyLabel(slug, kind).trim();
    if (legacyName && legacyName !== slug) return legacyName;
    return prettifySlug(slug);
  };

  return [
    ...serviceSlugs.map((slug) => {
      const snapshot = snapshotBySlug.get(slug);
      if (snapshot) return snapshot;
      const catalogKind = catalogBySlug.get(slug)?.kind;
      return {
        name: fallbackName(slug, "service"),
        kind: catalogKind === "bundle" || catalogKind === "a_la_carte"
          ? catalogKind
          : dependencies.legacyServiceKind(slug),
      } satisfies BookingCalendarSelectionItem;
    }),
    ...addOnSlugs.map((slug) =>
      snapshotBySlug.get(slug) ?? {
        name: fallbackName(slug, "addon"),
        kind: "addon" as const,
      }),
  ];
}

function normalizeSelectionSlugs(slugs: readonly string[]): string[] {
  const normalized = slugs.map((slug) => slug.trim());
  if (
    normalized.some((slug) => !slug) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error("Booking calendar selections are inconsistent");
  }
  return normalized;
}

function isSelectionKind(value: string): value is BookingCalendarSelectionKind {
  return value === "bundle" || value === "a_la_carte" || value === "addon";
}

function prettifySlug(slug: string): string {
  return slug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
