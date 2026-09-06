import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const canonicalInspectOutput = [
  "ID prj_QmEJtyuVnVhXILDCJiTPbZr2EdT5",
  "Name pixel-blaster-media",
  "Root Directory booking",
].join("\n");

function runDeployGuard({
  args = ["--check-only"],
  inspectOutput = canonicalInspectOutput,
  link = {
    projectId: "prj_QmEJtyuVnVhXILDCJiTPbZr2EdT5",
    projectName: "pixel-blaster-media",
  },
  trackedDirty = false,
  stagedDirty = false,
  untrackedDirty = false,
  head = "same-commit",
  originMain = "same-commit",
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "pixel-deploy-guard-"));
  const scripts = join(root, "booking", "scripts");
  const bin = join(root, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(root, ".vercel"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  const scriptPath = join(scripts, "deploy-production.sh");
  writeFileSync(scriptPath, deployScript);
  writeFileSync(join(scripts, "verify-production-evidence.mjs"), readFileSync(new URL("../scripts/verify-production-evidence.mjs", import.meta.url)));
  chmodSync(scriptPath, 0o755);
  writeFileSync(join(root, ".vercel", "project.json"), JSON.stringify(link));

  const fakeVercel = join(bin, "vercel");
  writeFileSync(fakeVercel, `#!/usr/bin/env bash
if [[ "$1 $2" == "project inspect" ]]; then
  printf '%s\\n' "$FAKE_VERCEL_INSPECT"
  exit 0
fi
if [[ "$*" == "--prod --yes" ]]; then
  printf 'DEPLOY_CWD=%s\\n' "$PWD"
  exit 0
fi
exit 2
`);
  chmodSync(fakeVercel, 0o755);

  const fakeGit = join(bin, "git");
  writeFileSync(fakeGit, `#!/usr/bin/env bash
case "$*" in
  *"fetch origin main") exit 0 ;;
  *"diff --cached --quiet") [[ "$FAKE_STAGED_DIRTY" == "1" ]] && exit 1 || exit 0 ;;
  *"diff --quiet") [[ "$FAKE_TRACKED_DIRTY" == "1" ]] && exit 1 || exit 0 ;;
  *"status --porcelain --untracked-files=normal") [[ "$FAKE_UNTRACKED_DIRTY" == "1" ]] && printf '?? unsafe-file\\n'; exit 0 ;;
  *"rev-parse origin/main") printf '%s\\n' "$FAKE_ORIGIN_MAIN"; exit 0 ;;
  *"rev-parse HEAD") printf '%s\\n' "$FAKE_HEAD"; exit 0 ;;
esac
exit 2
`);
  chmodSync(fakeGit, 0o755);

  try {
    return {
      root,
      result: spawnSync(scriptPath, args, {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_VERCEL_INSPECT: inspectOutput,
          FAKE_TRACKED_DIRTY: trackedDirty ? "1" : "0",
          FAKE_STAGED_DIRTY: stagedDirty ? "1" : "0",
          FAKE_UNTRACKED_DIRTY: untrackedDirty ? "1" : "0",
          FAKE_HEAD: head,
          FAKE_ORIGIN_MAIN: originMain,
        },
      }),
    };
  } finally {
    // The caller receives the path only for stdout assertions; the fixture is no longer needed.
    rmSync(root, { recursive: true, force: true });
  }
}

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

test("manual production deploys accept only the exact Vercel root directory", () => {
  const exact = runDeployGuard();
  assert.equal(exact.result.status, 0, exact.result.stderr);

  for (const inspectOutput of [
    canonicalInspectOutput.replace("Root Directory booking", "Root Directory booking-other"),
    canonicalInspectOutput.replace("Root Directory booking", "Not Root Directory booking"),
  ]) {
    const rejected = runDeployGuard({ inspectOutput });
    assert.notEqual(rejected.result.status, 0, inspectOutput);
    assert.match(rejected.result.stderr, /root directory is not booking/i);
  }
});

test("manual production deploys reject the duplicate project and unsafe Git states", () => {
  const duplicate = runDeployGuard({
    link: {
      projectId: "prj_Y68NisFMYvcAyKyrFjXlm5EOiiM8",
      projectName: "booking",
    },
  });
  assert.notEqual(duplicate.result.status, 0);
  assert.match(duplicate.result.stderr, /canonical Realtor-facing project/i);

  for (const unsafe of [
    { trackedDirty: true },
    { stagedDirty: true },
    { untrackedDirty: true },
    { head: "feature-commit", originMain: "main-commit" },
  ]) {
    const rejected = runDeployGuard({ args: [], ...unsafe });
    assert.notEqual(rejected.result.status, 0, JSON.stringify(unsafe));
    assert.doesNotMatch(rejected.result.stdout, /DEPLOY_CWD=/);
  }
});

test("clean exact origin/main alone cannot authorize a production deployment", () => {
  const clean = runDeployGuard({ args: [], head: "a".repeat(40), originMain: "a".repeat(40) });
  assert.notEqual(clean.result.status, 0, clean.result.stderr);
  assert.match(clean.result.stderr, /Production evidence blocked/);
  assert.doesNotMatch(clean.result.stdout, /DEPLOY_CWD=/);
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
