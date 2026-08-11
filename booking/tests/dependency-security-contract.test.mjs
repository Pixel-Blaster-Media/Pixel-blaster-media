import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const eslintConfig = readFileSync(new URL("../eslint.config.mjs", import.meta.url), "utf8");

function resolvedVersion(packageName) {
  return packageLock.packages[`node_modules/${packageName}`]?.version ?? null;
}

function versionAtLeast(actual, minimum) {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  return true;
}

test("the Next 16 security baseline declares its required runtime and lint entrypoint", () => {
  assert.equal(packageJson.engines.node, ">=20.9.0");
  assert.equal(packageJson.scripts.lint, "eslint .");
  assert.equal(packageJson.dependencies.next, "^16.3.0");
  assert.equal(packageJson.dependencies.react, "^19.2.8");
  assert.equal(packageJson.dependencies["react-dom"], "^19.2.8");
  assert.equal(packageJson.devDependencies["@types/react"], "^19.2.18");
  assert.equal(packageJson.devDependencies["@types/react-dom"], "^19.2.4");
  assert.equal(packageJson.devDependencies["eslint-config-next"], "^16.3.0");
  assert.equal(packageJson.devDependencies.postcss, "^8.5.26");
  assert.equal(packageJson.overrides.postcss, "^8.5.26");
});

test("the lockfile resolves patched production and development dependency versions", () => {
  const minimumVersions = {
    next: "16.3.0",
    sharp: "0.35.3",
    postcss: "8.5.26",
    nanoid: "3.3.18",
    "brace-expansion": "1.1.18",
    "js-yaml": "4.3.1",
  };
  for (const [packageName, minimum] of Object.entries(minimumVersions)) {
    const actual = resolvedVersion(packageName);
    assert.ok(actual, `${packageName} must be present in the lockfile`);
    assert.equal(versionAtLeast(actual, minimum), true, `${packageName} ${actual} must be at least ${minimum}`);
  }
});

test("React exposes the action-state API used by client forms", () => {
  assert.equal(React.version, "19.2.8");
  assert.equal(typeof React.useActionState, "function");
});

test("flat ESLint compatibility preserves the previous green baseline without hiding core web vitals", () => {
  assert.match(eslintConfig, /eslint-config-next\/core-web-vitals/);
  assert.match(eslintConfig, /react-hooks\/set-state-in-effect/);
  assert.match(eslintConfig, /react-hooks\/preserve-manual-memoization/);
  assert.match(eslintConfig, /globalIgnores/);
});
