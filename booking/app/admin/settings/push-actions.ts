"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  sendPushToProfile,
  type PushSendResult,
} from "@/lib/notifications/push";
import { getServiceSupabase } from "@/lib/supabase/server";

interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushActionResult {
  ok: boolean;
  error?: string;
  send?: PushSendResult;
}

export async function savePushSubscription(
  subscription: BrowserPushSubscription,
  userAgent: string,
): Promise<PushActionResult> {
  const admin = await requireAdmin();
  if (!validSubscription(subscription)) {
    return { ok: false, error: "The browser returned an invalid subscription." };
  }

  const service = getServiceSupabase();
  const { data: existing, error: lookupError } = await service
    .from("push_subscriptions")
    .select("organization_id, profile_id")
    .eq("endpoint", subscription.endpoint)
    .maybeSingle<{
      organization_id: string;
      profile_id: string;
    }>();

  if (lookupError) {
    return {
      ok: false,
      error:
        lookupError.code === "42P01"
          ? "Run the push-notifications database migration first."
          : lookupError.message,
    };
  }
  if (
    existing &&
    (existing.organization_id !== admin.organizationId ||
      existing.profile_id !== admin.userId)
  ) {
    return {
      ok: false,
      error:
        "This browser is already linked to another account. Turn off its notifications there before linking it here.",
    };
  }

  const { error } = await service
    .from("push_subscriptions")
    .upsert(
      {
        organization_id: admin.organizationId,
        profile_id: admin.userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: userAgent.slice(0, 500) || null,
      },
      { onConflict: "endpoint" },
    );

  if (error) {
    return {
      ok: false,
      error:
        error.code === "42P01"
          ? "Run the push-notifications database migration first."
          : error.message,
    };
  }
  return { ok: true };
}

export async function removePushSubscription(
  endpoint: string,
): Promise<PushActionResult> {
  const admin = await requireAdmin();
  if (!safeEndpoint(endpoint)) {
    return { ok: false, error: "Invalid notification endpoint." };
  }
  const { error } = await getServiceSupabase()
    .from("push_subscriptions")
    .delete()
    .eq("organization_id", admin.organizationId)
    .eq("profile_id", admin.userId)
    .eq("endpoint", endpoint);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function sendTestPush(): Promise<PushActionResult> {
  const admin = await requireAdmin();
  const send = await sendPushToProfile(admin.organizationId, admin.userId, {
    title: "Pixel Booking is connected",
    body: "App notifications are working on this device.",
    url: "/admin/calendar",
    tag: "push-test",
  });
  if (send.skipped || send.sent === 0) {
    return {
      ok: false,
      error: "No notification reached this device. Check the app permission and notification keys.",
      send,
    };
  }
  return { ok: true, send };
}

function validSubscription(
  value: BrowserPushSubscription,
): value is BrowserPushSubscription {
  return Boolean(
    safeEndpoint(value.endpoint) &&
      value.keys?.p256dh?.length >= 20 &&
      value.keys?.auth?.length >= 8,
  );
}

function safeEndpoint(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
