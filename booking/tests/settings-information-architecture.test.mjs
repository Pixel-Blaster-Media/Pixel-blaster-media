import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const settingsPageUrl = new URL("../app/admin/settings/page.tsx", import.meta.url);
const settingsHubUrl = new URL(
  "../app/admin/settings/SettingsHub.tsx",
  import.meta.url,
);
const preferencesPageUrl = new URL(
  "../app/admin/settings/preferences/page.tsx",
  import.meta.url,
);
const integrationsPageUrl = new URL(
  "../app/admin/settings/integrations/page.tsx",
  import.meta.url,
);

const settingsPage = readFileSync(settingsPageUrl, "utf8");
const settingsHub = readFileSync(settingsHubUrl, "utf8");
const integrationsPage = readFileSync(integrationsPageUrl, "utf8");

test("settings overview separates navigation from device and Today preferences", () => {
  assert.equal(existsSync(preferencesPageUrl), true);
  const preferencesPage = readFileSync(preferencesPageUrl, "utf8");

  assert.match(settingsPage, /href: "\/admin\/settings\/preferences"/);
  assert.doesNotMatch(settingsPage, /<InstallAppCard/);
  assert.doesNotMatch(settingsPage, /TodayPreferencesCard/);
  assert.match(preferencesPage, /<InstallAppCard/);
  assert.match(preferencesPage, /TodayPreferencesCard/);
});

test("launch readiness shows only items that still need attention", () => {
  assert.match(settingsPage, /const remainingItems = readiness\.items\.filter/);
  assert.match(settingsPage, /remainingItems\.map/);
  assert.doesNotMatch(settingsPage, /readiness\.items\.map/);
});

test("settings navigation uses grouped flat rows instead of mobile accordions", () => {
  assert.match(settingsPage, /title: "Business setup"/);
  assert.match(settingsPage, /title: "Tools & workflow"/);
  assert.match(settingsPage, /title: "Platform administration"/);
  assert.match(settingsHub, /divide-y/);
  assert.doesNotMatch(settingsHub, /useState/);
  assert.doesNotMatch(settingsHub, />Hide</);
  assert.doesNotMatch(settingsHub, /aria-expanded/);
});

test("integrations start with a status index and stable provider anchors", () => {
  assert.match(integrationsPage, /Integration status at a glance/);
  for (const providerId of [
    "google-calendar",
    "quickbooks",
    "email-delivery",
    "iguide",
    "autoenhance",
    "ai-assistant",
    "google-maps",
  ]) {
    assert.match(integrationsPage, new RegExp(`id=["']${providerId}["']`));
    assert.match(integrationsPage, new RegExp(`href=["']#${providerId}["']`));
  }
});

test("integration credentials and diagnostics are progressively disclosed", () => {
  const disclosures = integrationsPage.match(/<details/g) ?? [];
  assert.ok(disclosures.length >= 5, "expected advanced provider disclosures");
  assert.match(integrationsPage, /Configuration & diagnostics/);

  const emailDetails = integrationsPage.indexOf('id="email-configuration"');
  const emailCredentials = integrationsPage.indexOf('provider="resend"');
  const aiDetails = integrationsPage.indexOf('id="ai-configuration"');
  const aiTester = integrationsPage.indexOf("<OpenAITester");
  const iguideDetails = integrationsPage.indexOf('id="iguide-configuration"');
  const iguideTester = integrationsPage.indexOf("<IGuideTester");

  assert.ok(emailDetails >= 0 && emailDetails < emailCredentials);
  assert.ok(aiDetails >= 0 && aiDetails < aiTester);
  assert.ok(iguideDetails >= 0 && iguideDetails < iguideTester);
});

test("integration readiness includes required workflow configuration", () => {
  assert.match(integrationsPage, /const autoenhanceReady =/);
  assert.match(integrationsPage, /open={!autoenhanceReady}/);
  assert.match(integrationsPage, /const quickBooksReady =/);
  assert.match(integrationsPage, /open={!quickBooksReady}/);
  assert.match(integrationsPage, /connection\?\.default_item_id/);
});

test("QuickBooks readiness requires credentials and a usable active item mapping", () => {
  assert.match(integrationsPage, /process\.env\.QUICKBOOKS_CLIENT_ID/);
  assert.match(integrationsPage, /process\.env\.QUICKBOOKS_CLIENT_SECRET/);
  assert.match(integrationsPage, /!itemError/);
  assert.match(integrationsPage, /items\?\.some/);
  assert.match(integrationsPage, /item\.Id === connection\?\.default_item_id/);
  assert.match(integrationsPage, /open={!quickBooksReady}/);
});

test("settings readiness and preference copy describe their true scope", () => {
  const preferencesPage = readFileSync(preferencesPageUrl, "utf8");
  assert.match(settingsPage, /process\.env\.GOOGLE_CLIENT_ID/);
  assert.match(settingsPage, /process\.env\.GOOGLE_CLIENT_SECRET/);
  assert.match(preferencesPage, /company.*Today/i);
  assert.doesNotMatch(preferencesPage, /Personalize this device/);
});

test("OAuth error callback URLs wrap on narrow screens", () => {
  assert.match(
    integrationsPage,
    /<code className="break-all">\{process\.env\.NEXT_PUBLIC_APP_URL\}/,
  );
  assert.match(
    integrationsPage,
    /<code className="break-all">\{resolvedGoogleRedirectUri\}<\/code>/,
  );
});

test("connected Calendar and QuickBooks details stay quiet until needed", () => {
  const calendarDetails = integrationsPage.indexOf(
    'id="calendar-configuration"',
  );
  const calendarTester = integrationsPage.indexOf("<GoogleCalendarTester");
  const quickBooksDetails = integrationsPage.indexOf(
    'id="quickbooks-configuration"',
  );
  const itemPicker = integrationsPage.indexOf("<ItemPicker");

  assert.ok(calendarDetails >= 0 && calendarDetails < calendarTester);
  assert.ok(quickBooksDetails >= 0 && quickBooksDetails < itemPicker);
  assert.match(integrationsPage, /open={!googleReady}/);
  assert.match(integrationsPage, /open={!quickBooksReady}/);
});
