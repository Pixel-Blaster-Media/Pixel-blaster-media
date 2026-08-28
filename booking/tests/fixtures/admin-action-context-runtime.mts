process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-key";

globalThis.fetch = async () =>
  new Response("[]", {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-range": "0-0/0",
    },
  });

interface AdminFixtureContext {
  userId: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  verifiedIdentity: Readonly<{ id: string; email?: string }>;
}

type AdversarialContextModule = {
  getVerifiedAdminActionContext(): AdminFixtureContext | null;
  runWithVerifiedAdminActionContext<Result>(
    admin: AdminFixtureContext,
    operation: () => Result,
  ): Promise<Awaited<Result>>;
};

const unwrap = (module: Record<string, unknown>): Record<string, unknown> =>
  (module.default as Record<string, unknown> | undefined) ?? module;
const context = unwrap(
  await import("@/lib/auth/admin-action-context"),
) as unknown as AdversarialContextModule;
const { requireAdmin } = unwrap(
  await import("../../lib/auth/require-admin.ts"),
) as unknown as { requireAdmin(): Promise<AdminFixtureContext> };
const { createAdminShoot } = unwrap(
  await import("../../app/admin/calendar/actions.ts"),
) as unknown as { createAdminShoot(formData: FormData): Promise<unknown> };
const { updateBookingStatus, sendDeliveryReadyEmail } = unwrap(
  await import("../../app/admin/bookings/[id]/actions.ts"),
) as unknown as {
  updateBookingStatus(bookingId: string, next: "shot"): Promise<unknown>;
  sendDeliveryReadyEmail(bookingId: string): Promise<unknown>;
};

const {
  getVerifiedAdminActionContext,
  runWithVerifiedAdminActionContext,
} = context;
const adminA = {
  userId: "admin-a",
  organizationId: "org-a",
  email: "admin-a@example.invalid",
  fullName: "Admin A",
  verifiedIdentity: Object.freeze({
    id: "admin-a",
    email: "admin-a@example.invalid",
  }),
};
const adminB = {
  userId: "admin-b",
  organizationId: "org-b",
  email: "admin-b@example.invalid",
  fullName: "Admin B",
  verifiedIdentity: Object.freeze({
    id: "admin-b",
    email: "admin-b@example.invalid",
  }),
};

const callerOwnedAdmin = {
  ...adminA,
  userId: "immutable-admin",
  organizationId: "immutable-org",
};
const immutableContext = await runWithVerifiedAdminActionContext(
  callerOwnedAdmin,
  () => {
    const inherited = getVerifiedAdminActionContext();
    if (!inherited) throw new Error("verified context was not installed");
    const sameObject = inherited === callerOwnedAdmin;
    const frozen = Object.isFrozen(inherited);
    let mutationRejected = false;
    try {
      inherited.userId = "attacker-controlled";
    } catch {
      mutationRejected = true;
    }
    callerOwnedAdmin.organizationId = "caller-mutated";
    return {
      sameObject,
      frozen,
      mutationRejected,
      userId: inherited.userId,
      organizationId: inherited.organizationId,
    };
  },
);

const outsideBefore = getVerifiedAdminActionContext();
const inheritedGuard = await runWithVerifiedAdminActionContext(
  adminA,
  () => requireAdmin(),
);

let markBStarted!: () => void;
const bStarted = new Promise<void>((resolve) => {
  markBStarted = resolve;
});
let markACompleted!: () => void;
const aCompleted = new Promise<void>((resolve) => {
  markACompleted = resolve;
});

const requestA = runWithVerifiedAdminActionContext(adminA, async () => {
  await bStarted;
  return getVerifiedAdminActionContext()?.userId ?? null;
});
const requestB = runWithVerifiedAdminActionContext(adminB, async () => {
  markBStarted();
  await aCompleted;
  return getVerifiedAdminActionContext()?.userId ?? null;
});
const observedA = await requestA;
markACompleted();
const observedB = await requestB;

let resolveDetached!: (value: string | null) => void;
const detachedObservation = new Promise<string | null>((resolve) => {
  resolveDetached = resolve;
});
await runWithVerifiedAdminActionContext(adminA, async () => {
  setImmediate(() => {
    resolveDetached(getVerifiedAdminActionContext()?.userId ?? null);
  });
});
const detachedAfterSettlement = await detachedObservation;
const outsideAfter = getVerifiedAdminActionContext();

async function rejectsWithoutRequest(
  operation: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
console.error = () => undefined;
console.warn = () => undefined;
let directActionRejections;
try {
  directActionRejections = {
    create: await rejectsWithoutRequest(() => createAdminShoot(new FormData())),
    update: await rejectsWithoutRequest(() =>
      updateBookingStatus("synthetic-booking", "shot"),
    ),
    delivery: await rejectsWithoutRequest(() =>
      sendDeliveryReadyEmail("synthetic-booking"),
    ),
  };
} finally {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
}

process.stdout.write(
  `${JSON.stringify({
    outsideBefore,
    immutableContext,
    inheritedGuardUserId: inheritedGuard.userId,
    concurrent: [observedA, observedB],
    detachedAfterSettlement,
    outsideAfter,
    directActionRejections,
  })}\n`,
);
