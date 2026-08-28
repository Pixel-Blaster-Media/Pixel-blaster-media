import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { tsImport } from "tsx/esm/api";

const coreModule = await tsImport(
  "../lib/auth/platform-admin-access-core.ts",
  import.meta.url,
);
const { hasVerifiedPlatformAdminAccess } = coreModule.default ?? coreModule;
const requirePlatformAdminSource = await readFile(
  new URL("../lib/auth/require-platform-admin.ts", import.meta.url),
  "utf8",
);

const admin = { userId: "admin-user" };
const allowlist = ["owner@example.invalid"];
const authenticated = (overrides = {}) => ({
  kind: "authenticated",
  user: {
    id: admin.userId,
    email: "OWNER@EXAMPLE.INVALID",
    ...overrides,
  },
});

test("platform access requires the verified identity ID and allowlisted email", () => {
  assert.equal(
    hasVerifiedPlatformAdminAccess(admin.userId, authenticated(), allowlist),
    true,
  );
  assert.equal(
    hasVerifiedPlatformAdminAccess(
      admin.userId,
      authenticated({ id: "different-user" }),
      allowlist,
    ),
    false,
  );
  assert.equal(
    hasVerifiedPlatformAdminAccess(
      admin.userId,
      authenticated({ email: "other@example.invalid" }),
      allowlist,
    ),
    false,
  );
  assert.equal(
    hasVerifiedPlatformAdminAccess(
      admin.userId,
      authenticated({ email: null }),
      allowlist,
    ),
    false,
  );
});

test("platform access fails closed for non-authenticated identity states and empty policy", () => {
  for (const kind of ["missing", "invalid", "unavailable"]) {
    assert.equal(
      hasVerifiedPlatformAdminAccess(admin.userId, { kind }, allowlist),
      false,
    );
  }
  assert.equal(
    hasVerifiedPlatformAdminAccess(admin.userId, authenticated(), []),
    false,
  );
});

test("the server gate delegates to the executable verified-identity policy", () => {
  assert.match(
    requirePlatformAdminSource,
    /user: admin\.verifiedIdentity/,
  );
  assert.doesNotMatch(requirePlatformAdminSource, /admin\.email\.toLowerCase\(\)/);
  assert.doesNotMatch(requirePlatformAdminSource, /auth\.getSession\(\)/);
  assert.doesNotMatch(
    requirePlatformAdminSource,
    /getRequestVerifiedIdentity/,
    "platform authorization must use identity already verified by requireAdmin",
  );
});
