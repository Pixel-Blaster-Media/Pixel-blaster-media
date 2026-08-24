import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(process.cwd(), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("pull requests run fail-closed application and PostgreSQL gates", async () => {
  const workflow = await source(".github/workflows/ci.yml");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /npm run test:http-security/);
  assert.ok(
    workflow.indexOf("npm run test:http-security") >
      workflow.indexOf("npm run build"),
    "the HTTP security gate must exercise the built artifact",
  );
  assert.match(workflow, /npm audit --omit=dev --audit-level=high/);
  assert.match(workflow, /postgresql-17/);
  assert.match(workflow, /\/usr\/lib\/postgresql\/17\/bin/);
  assert.match(workflow, /verify-atomic-booking-postgres\.sh/);
  assert.match(workflow, /verify-integration-credentials-postgres\.sh/);
  assert.match(workflow, /verify-catalog-item-examples-postgres\.sh/);
  assert.match(workflow, /verify-canonical-media-postgres\.sh/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);

  const applicationJob = workflow.slice(
    workflow.indexOf("  application:"),
    workflow.indexOf("  postgresql:"),
  );
  const applicationJobHeader = applicationJob.slice(
    0,
    applicationJob.indexOf("    steps:"),
  );
  assert.doesNotMatch(
    applicationJobHeader,
    /VERCEL_ENV:/,
    "production-only Vercel mode must not contaminate the full test suite",
  );
  assert.match(
    applicationJob,
    /Build production-shaped artifact[\s\S]*?env:\s*\n\s*VERCEL_ENV: production[\s\S]*?run: npm run build/,
  );
});

test("the application exposes a built-artifact HTTP security gate", async () => {
  const packageJson = JSON.parse(await source("booking/package.json"));
  assert.equal(
    packageJson.scripts["test:http-security"],
    "node scripts/verify-security-http.mjs",
  );

  const probe = await source("booking/scripts/verify-security-http.mjs");
  assert.match(probe, /alias_extension_mutation/);
  assert.match(probe, /bridge_chunked_body_limit/);
  assert.match(probe, /live_security_headers/);
});

test("dependency updates are grouped weekly for the booking application", async () => {
  const dependabot = await source(".github/dependabot.yml");
  assert.match(dependabot, /package-ecosystem: "npm"/);
  assert.match(dependabot, /directory: "\/booking"/);
  assert.match(dependabot, /interval: "weekly"/);
  assert.match(dependabot, /groups:/);
});
