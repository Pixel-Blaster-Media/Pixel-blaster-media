import assert from "node:assert/strict";
import test from "node:test";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadSource } from "./helpers/source-module.mjs";
import * as codec from "../lib/booking/wizard-draft-codec.ts";
import * as stateHelpers from "../lib/booking/wizard-state.ts";

const require = createRequire(import.meta.url);
const secret = "fixture-private-draft-key";
const property = {
  streetAddress: "123 Private Street", unitNumber: "4B", city: "Hamilton", postalCode: "L1L 1L1",
  squareFootage: 2500, isVacant: "occupied", includeBasement: true,
  shotRequests: ["pool"], shootNotes: "Access code SECRET-123. Call before entering.",
};
const prefix = "pb_booking_draft_";

test("draft encryption round-trips, expires and authenticates both company and draft identity", () => {
  const sealed = codec.sealWizardDraft(property, secret, "org-a:draft-a", 1000);
  assert.deepEqual(codec.openWizardDraft(sealed, secret, "org-a:draft-a", 1001), property);
  assert.equal(codec.openWizardDraft(sealed, secret, "org-b:draft-a", 1001), null);
  assert.equal(codec.openWizardDraft(sealed, secret, "org-a:draft-b", 1001), null);
  assert.equal(codec.openWizardDraft(sealed, "rotated", "org-a:draft-a", 1001), null);
  assert.equal(codec.openWizardDraft(sealed, secret, "org-a:draft-a", 1000 + codec.DRAFT_TTL_SECONDS * 1000), null);
  const tampered = Buffer.from(sealed, "base64url"); tampered[30] ^= 1;
  assert.equal(codec.openWizardDraft(tampered.toString("base64url"), secret, "org-a:draft-a", 1001), null);
  assert.equal(Buffer.from(sealed, "base64url").includes(Buffer.from("SECRET-123")), false);
  assert.throws(() => codec.sealWizardDraft(property, "", "binding"), /unavailable/);
});

test("oversized/malformed property input is rejected without silently losing notes", () => {
  for (const input of [null, [], { squareFootage: -1 }, { isVacant: ["vacant"] }, { includeBasement: "yes" }, { shotRequests: [false] }, { shootNotes: "x".repeat(1700) }]) {
    assert.throws(() => codec.normalizePrivateProperty(input));
  }
  const normalized = codec.normalizePrivateProperty({ ...property, shootNotes: "🔑".repeat(800) });
  assert.throws(() => codec.sealWizardDraft(normalized, secret, "binding"), /too long/);
});

function harness({ jar = new Map(), organizationId = "org-a" } = {}) {
  const writes = [];
  const cookies = {
    get: (name) => jar.has(name) ? { value: jar.get(name) } : undefined,
    getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
    set(name, value, options) {
      writes.push({ name, value, options });
      if (options.maxAge === 0) jar.delete(name); else jar.set(name, value);
    },
  };
  const draft = loadSource("lib/booking/wizard-draft.ts", {
    "next/headers": { cookies: async () => cookies },
    "next/navigation": { redirect: (url) => { throw Object.assign(new Error("redirect"), { url }); } },
    "./wizard-draft-codec": codec,
    "./wizard-state": stateHelpers,
  }, { process: { env: { BOOKING_MANAGE_SECRET: secret, NODE_ENV: "production" } } });
  const actions = loadSource("app/book/draft-actions.ts", {
    "node:crypto": crypto,
    "next/headers": { cookies: async () => cookies },
    "@/lib/organizations/public-booking": { resolvePublicBookingOrganization: async (slug) => slug === "unknown" ? null : { id: organizationId, slug: "studio" } },
    "@/lib/booking/wizard-state": stateHelpers,
    "@/lib/booking/wizard-draft-codec": codec,
    "@/lib/booking/wizard-draft": draft,
  }, { process: { env: { NODE_ENV: "production" } } });
  return { actions, draft, jar, writes };
}

test("saving posts private details once and returns a URL without property, access or occupancy data", async () => {
  const h = harness();
  const saved = await h.actions.saveBookingWizardDraft({ query: "services=photos&slot=old&shoot_notes=legacy-secret&unexpected=value", property });
  assert.equal(saved.ok, true);
  const query = new URLSearchParams(saved.query);
  assert.deepEqual([...query.keys()].sort(), ["draft", "org", "services"]);
  assert.equal(query.get("services"), "photos");
  assert.doesNotMatch(saved.query, /SECRET|Private|occupied|shoot_notes|address/);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].options)), { httpOnly: true, secure: true, sameSite: "lax", path: "/book", maxAge: 7200 });
  const state = h.draft.readPublicWizardState(Object.fromEntries(query), "/book/property");
  assert.equal((await h.draft.loadPrivateWizardState(state, "org-a")).shootNotes, property.shootNotes);
  assert.equal((await h.draft.loadPrivateWizardState(state, "org-b")).shootNotes, "");
  const stranger = harness();
  assert.equal((await stranger.draft.loadPrivateWizardState(state, "org-a")).shootNotes, "");
});

test("refresh/back/forward, changed selections and a saved edit retain the browser draft reference", async () => {
  const h = harness();
  const first = await h.actions.saveBookingWizardDraft({ query: "services=photos", property });
  const params = new URLSearchParams(first.query);
  params.set("services", "video,photos"); params.set("add_ons", "aerial_add_on"); params.set("slot", "2090-01-01T15:00:00Z");
  const links = stateHelpers.publicWizardQuery(params);
  const reloaded = await h.draft.loadPrivateWizardState(h.draft.readPublicWizardState(Object.fromEntries(links), "/book/confirm"), "org-a");
  assert.equal(reloaded.shootNotes, property.shootNotes);
  assert.deepEqual(reloaded.services, ["video", "photos"]);
  assert.equal(reloaded.slot, "2090-01-01T15:00:00Z");
  const edited = await h.actions.saveBookingWizardDraft({ query: links.toString(), property: { ...property, shootNotes: "Updated access instruction" } });
  const editedParams = new URLSearchParams(edited.query);
  assert.equal(editedParams.get("draft"), params.get("draft"));
  assert.equal(editedParams.has("slot"), false);
  const back = await h.draft.loadPrivateWizardState(h.draft.readPublicWizardState(Object.fromEntries(params), "/book/property"), "org-a");
  assert.equal(back.shootNotes, "Updated access instruction");
});

test("separate tabs stay separate; cookie count is bounded and explicit discard clears only its draft", async () => {
  const h = harness();
  const save = async (notes) => h.actions.saveBookingWizardDraft({ query: "services=photos", property: { ...property, shootNotes: notes } });
  const first = await save("First"); const second = await save("Second");
  const firstId = new URLSearchParams(first.query).get("draft");
  const secondId = new URLSearchParams(second.query).get("draft");
  assert.notEqual(firstId, secondId); assert.equal(h.jar.size, 2);
  await h.draft.clearPrivateWizardDraft(firstId);
  assert.equal(h.jar.has(prefix + firstId), false);
  assert.equal(h.jar.has(prefix + secondId), true);
  await save("Third"); await save("Fourth");
  assert.equal(h.jar.size, 2);
  const before = new Map(h.jar);
  const failed = await h.actions.saveBookingWizardDraft({ query: second.query, property: { ...property, shootNotes: "x".repeat(1700) } });
  assert.equal(failed.ok, false); assert.deepEqual(h.jar, before);
});

test("committed completion replaces private fields with a scoped receipt before action rerender; replay and reload stay completed", async () => {
  const h = harness();
  const first = await h.actions.saveBookingWizardDraft({ query: "services=photos", property });
  const other = await h.actions.saveBookingWizardDraft({ query: "services=photos", property: { ...property, shootNotes: "Other flow" } });
  const draftId = new URLSearchParams(first.query).get("draft");
  const otherId = new URLSearchParams(other.query).get("draft");
  const otherValue = h.jar.get(prefix + otherId);
  const completed = { redirectTo: "/portal/property-1?booked=1", receipt: {
    address: "123 Private Street", when: "Thursday at 9am", services: ["Photos"], organizationName: "Studio",
  } };
  assert.equal(await h.draft.hasActivePrivateWizardDraft(draftId, "org-b"), false);
  assert.equal(await h.draft.hasActivePrivateWizardDraft(draftId, "org-a"), true);
  await h.draft.completePrivateWizardDraft(draftId, "org-a", completed);
  assert.equal(codec.openWizardDraft(h.jar.get(prefix + draftId), secret, `org-a:${draftId}`), null);
  assert.deepEqual(JSON.parse(JSON.stringify(await h.draft.loadCompletedWizardReceipt(draftId, "org-a"))), completed);
  assert.equal(await h.draft.loadCompletedWizardReceipt(draftId, "org-b"), null);
  assert.equal(h.jar.get(prefix + otherId), otherValue);
  await assert.rejects(() => h.draft.loadPrivateWizardState(stateHelpers.parseWizardState(Object.fromEntries(new URLSearchParams(first.query))), "org-a"), error => error.url.startsWith("/book/confirm?"));
  await h.draft.completePrivateWizardDraft(draftId, "org-a", completed);
  assert.deepEqual(JSON.parse(JSON.stringify(await h.draft.loadCompletedWizardReceipt(draftId, "org-a"))), completed);
  const receiptCookie = h.jar.get(prefix + draftId);
  assert.equal(codec.openWizardReceipt(receiptCookie, secret, `org-a:${draftId}`, Date.now() + codec.DRAFT_TTL_SECONDS * 1000), null);
  assert.throws(() => codec.sealWizardReceipt({ ...completed, redirectTo: "//attacker.invalid" }, secret, "binding"));
  assert.equal(h.writes.at(-1).options.httpOnly, true);
  assert.equal(h.writes.at(-1).options.secure, true);
});

test("legacy URLs redirect without forwarding private data; unknown company cannot write a draft", async () => {
  const h = harness();
  assert.throws(() => h.draft.readPublicWizardState({ services: "photos", address: property.streetAddress, shoot_notes: property.shootNotes }, "/book/property"), (error) => {
    const url = new URL(error.url, "https://example.invalid");
    assert.equal(url.searchParams.get("services"), "photos");
    assert.equal(url.searchParams.has("shoot_notes"), false); assert.equal(url.searchParams.has("address"), false);
    return true;
  });
  assert.equal((await h.actions.saveBookingWizardDraft({ query: "org=unknown", property })).ok, false);
  assert.equal(h.jar.size, 0);
});

test("rendered mobile step links have distinct accessible names and never expose private fields", () => {
  const Stepper = loadSource("app/book/_components/Stepper.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/booking/wizard-state": stateHelpers,
  }).default;
  const state = { ...stateHelpers.parseWizardState({ services: "photos", draft: crypto.randomUUID(), slot: "2090-01-01T15:00:00Z" }), ...property };
  const html = renderToStaticMarkup(React.createElement(Stepper, { current: 4, state }));
  const names = [...html.matchAll(/<a\b[^>]*>(.*?)<\/a>/g)].map((match) => match[1].replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, "").trim());
  assert.deepEqual(names, ["Services", "Property", "When"]);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /hidden md:inline|SECRET-123|Private Street|occupied/);
});


test("authorized completion restores only a minimal receipt after expiry or eviction, keeping cookies bounded", async () => {
  const h = harness();
  const expiredId = crypto.randomUUID();
  h.jar.set(prefix + expiredId, codec.sealWizardDraft(property, secret, `org-a:${expiredId}`, Date.now() - codec.DRAFT_TTL_SECONDS * 1000));
  assert.equal(await h.draft.hasActivePrivateWizardDraft(expiredId, "org-a"), false);
  const completed = { redirectTo: "/portal/property-1?booked=1", receipt: { address: "123 Private Street", when: "Tomorrow", services: ["Photos"], organizationName: "Studio" } };
  await h.draft.completePrivateWizardDraft(expiredId, "org-a", completed);
  assert.deepEqual(JSON.parse(JSON.stringify(await h.draft.loadCompletedWizardReceipt(expiredId, "org-a"))), completed);
  assert.equal(await h.draft.hasActivePrivateWizardDraft(expiredId, "org-a"), false);
  h.jar.delete(prefix + expiredId);
  for(let index=0;index<2;index++) await h.actions.saveBookingWizardDraft({query:"services=photos",property});
  await h.draft.completePrivateWizardDraft(expiredId, "org-a", completed);
  assert.equal(h.jar.size, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(await h.draft.loadCompletedWizardReceipt(expiredId, "org-a"))), completed);
  assert.equal(await h.draft.loadCompletedWizardReceipt(expiredId, "org-b"), null);
  assert.equal(await h.draft.hasActivePrivateWizardDraft("invalid", "org-a"), false);
});
