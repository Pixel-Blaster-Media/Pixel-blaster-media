import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);
const outboxDocs = readFileSync(
  new URL("../docs/INTEGRATION_OUTBOX.md", import.meta.url),
  "utf8",
);
const deployScriptUrl = new URL("../scripts/deploy-production.sh", import.meta.url);
const deployScript = existsSync(deployScriptUrl)
  ? readFileSync(deployScriptUrl, "utf8")
  : "";
const deploymentPolicy = readFileSync(
  new URL("../../DEPLOYMENT.md", import.meta.url),
  "utf8",
);

test("Vercel deploys booking automatically only from main", () => {
  assert.equal(config.git?.deploymentEnabled?.["**"], false);
  assert.equal(config.git?.deploymentEnabled?.main, true);
});

test("manual production deploys fail closed unless linked to the Realtor-facing project", () => {
  assert.ok(deployScript, "canonical production deployment script is required");
  assert.match(deployScript, /prj_QmEJtyuVnVhXILDCJiTPbZr2EdT5/);
  assert.match(deployScript, /pixel-blaster-media/);
  assert.match(deployScript, /Root Directory[\s\S]*booking|root directory[\s\S]*booking/i);
  assert.match(deployScript, /cd "\$REPO_ROOT"/);
  assert.match(deployScript, /vercel --prod --yes/);
  assert.doesNotMatch(deployScript, /project booking(?:\s|$)/i);
  assert.match(deploymentPolicy, /canonical[\s\S]*`pixel-blaster-media`/i);
  assert.match(deploymentPolicy, /`booking`[\s\S]*noncanonical/i);
  assert.match(deploymentPolicy, /scripts\/deploy-production\.sh/);
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
