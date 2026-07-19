import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);
const outboxDocs = readFileSync(
  new URL("../docs/INTEGRATION_OUTBOX.md", import.meta.url),
  "utf8",
);

test("Vercel deploys booking automatically only from main", () => {
  assert.equal(config.git?.deploymentEnabled?.["**"], false);
  assert.equal(config.git?.deploymentEnabled?.main, true);
});

test("deployment cost controls keep both jobs daily and document current plan limits", () => {
  assert.deepEqual(config.crons, [
    {
      path: "/api/cron/reminders",
      schedule: "0 21 * * *",
    },
    {
      path: "/api/cron/integration-outbox",
      schedule: "5 21 * * *",
    },
  ]);
  assert.match(outboxDocs, /Hobby[\s\S]*100 cron jobs[\s\S]*once per day/i);
  assert.match(outboxDocs, /one additional function invocation per day/i);
});
