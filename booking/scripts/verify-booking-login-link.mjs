import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const layoutPath = join(root, "app/book/layout.tsx");
const source = readFileSync(layoutPath, "utf8");

const requiredSnippets = [
  'href="/auth/sign-in?next=/portal"',
  "Already booked?",
  "Open client portal",
];

const missing = requiredSnippets.filter((snippet) => !source.includes(snippet));
const portalLinkCount = source.match(/href="\/auth\/sign-in\?next=\/portal"/g)
  ?.length ?? 0;

if (missing.length > 0 || portalLinkCount < 1) {
  console.error(
    [
    "Booking page guard failed: the client portal entry must stay available in the booking flow.",
      missing.length > 0 ? `Missing: ${missing.join(", ")}` : null,
      portalLinkCount < 1
        ? `Expected at least 1 portal login link, found ${portalLinkCount}.`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  process.exit(1);
}

console.log("Booking page guard passed: client portal entry is present.");
