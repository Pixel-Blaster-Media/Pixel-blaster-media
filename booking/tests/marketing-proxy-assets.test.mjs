import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
);
const bookingLayout = readFileSync(
  new URL("../app/book/layout.tsx", import.meta.url),
  "utf8",
);

test("marketing proxy keeps every booking-owned browser namespace same-origin", () => {
  const expectedRewrites = [
    ["/_next/:path*", "https://pixel-blaster-media.vercel.app/_next/:path*"],
    ["/listings", "https://pixel-blaster-media.vercel.app/listings"],
    ["/listings/:path*", "https://pixel-blaster-media.vercel.app/listings/:path*"],
    ["/beta", "https://pixel-blaster-media.vercel.app/beta"],
    ["/beta/:path*", "https://pixel-blaster-media.vercel.app/beta/:path*"],
    ["/start", "https://pixel-blaster-media.vercel.app/start"],
    ["/start/:path*", "https://pixel-blaster-media.vercel.app/start/:path*"],
    [
      "/manifest.webmanifest",
      "https://pixel-blaster-media.vercel.app/manifest.webmanifest",
    ],
    ["/sw.js", "https://pixel-blaster-media.vercel.app/sw.js"],
    ["/offline.html", "https://pixel-blaster-media.vercel.app/offline.html"],
    ["/icons/:path*", "https://pixel-blaster-media.vercel.app/icons/:path*"],
    ["/icon.png", "https://pixel-blaster-media.vercel.app/icon.png"],
    ["/apple-icon.png", "https://pixel-blaster-media.vercel.app/apple-icon.png"],
  ];
  for (const [source, destination] of expectedRewrites) {
    assert.deepEqual(
      config.rewrites.find((rule) => rule.source === source),
      { source, destination },
      source,
    );
  }
  assert.equal(
    config.redirects.some((rule) => rule.source === "/_next/:path*"),
    false,
  );
});

test("booking metadata uses the configured apex public origin as canonical", () => {
  assert.match(
    bookingLayout,
    /alternates:\s*\{\s*canonical:\s*"https:\/\/pixelblastermedia\.com\/book"\s*\}/,
  );
  assert.doesNotMatch(bookingLayout, /https:\/\/www\.pixelblastermedia\.com\/book/);
});
