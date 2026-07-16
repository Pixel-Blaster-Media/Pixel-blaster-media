import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);

test("Vercel deploys booking automatically only from main", () => {
  assert.equal(config.git?.deploymentEnabled?.["**"], false);
  assert.equal(config.git?.deploymentEnabled?.main, true);
});

test("deployment cost controls preserve the production reminder cron", () => {
  assert.deepEqual(config.crons, [
    {
      path: "/api/cron/reminders",
      schedule: "0 21 * * *",
    },
  ]);
});
