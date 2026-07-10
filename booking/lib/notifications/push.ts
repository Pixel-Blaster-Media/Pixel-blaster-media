import "server-only";

import type webPush from "web-push";

import { getServiceSupabase } from "@/lib/supabase/server";

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  removed: number;
  skipped: boolean;
}

let webPushClientPromise: Promise<typeof webPush> | null = null;

export function publicVapidKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
}

export function pushNotificationsConfigured(): boolean {
  return Boolean(
    publicVapidKey() &&
      process.env.VAPID_PRIVATE_KEY?.trim() &&
      process.env.VAPID_SUBJECT?.trim(),
  );
}

export async function sendPushToOrganization(
  organizationId: string,
  message: PushMessage,
): Promise<PushSendResult> {
  return sendPush({ organizationId, message });
}

export async function sendPushToProfile(
  organizationId: string,
  profileId: string,
  message: PushMessage,
): Promise<PushSendResult> {
  return sendPush({ organizationId, profileId, message });
}

export async function sendPushBestEffort(
  organizationId: string,
  message: PushMessage,
): Promise<void> {
  try {
    await sendPushToOrganization(organizationId, message);
  } catch (error) {
    console.warn("[push] notification failed", safeErrorMessage(error));
  }
}

async function sendPush({
  organizationId,
  profileId,
  message,
}: {
  organizationId: string;
  profileId?: string;
  message: PushMessage;
}): Promise<PushSendResult> {
  if (!pushNotificationsConfigured()) {
    return { sent: 0, failed: 0, removed: 0, skipped: true };
  }

  const supabase = getServiceSupabase();
  let query = supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("organization_id", organizationId);
  if (profileId) query = query.eq("profile_id", profileId);
  const { data, error } = await query.returns<PushSubscriptionRow[]>();
  if (error) {
    if (error.code !== "42P01") {
      console.warn("[push] subscription lookup failed", error.message);
    }
    return { sent: 0, failed: 0, removed: 0, skipped: true };
  }

  const subscriptions = data ?? [];
  if (!subscriptions.length) {
    return { sent: 0, failed: 0, removed: 0, skipped: true };
  }

  const client = await getWebPushClient();
  const payload = JSON.stringify({
    ...message,
    url: safeAppPath(message.url),
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  });
  let sent = 0;
  let failed = 0;
  const expiredIds: string[] = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await client.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          { TTL: 60 * 60, urgency: "high" },
        );
        sent += 1;
      } catch (error) {
        const statusCode = pushStatusCode(error);
        if (statusCode === 404 || statusCode === 410) {
          expiredIds.push(subscription.id);
        } else {
          failed += 1;
          console.warn("[push] provider rejected notification", {
            statusCode,
            message: safeErrorMessage(error),
          });
        }
      }
    }),
  );

  if (expiredIds.length) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("organization_id", organizationId)
      .in("id", expiredIds);
  }

  return {
    sent,
    failed,
    removed: expiredIds.length,
    skipped: false,
  };
}

async function getWebPushClient(): Promise<typeof webPush> {
  if (!webPushClientPromise) {
    webPushClientPromise = import("web-push").then((module) => {
      const client = module.default;
      client.setVapidDetails(
        process.env.VAPID_SUBJECT!.trim(),
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
        process.env.VAPID_PRIVATE_KEY!.trim(),
      );
      return client;
    });
  }
  return webPushClientPromise;
}

function safeAppPath(value: string): string {
  return value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/admin/calendar";
}

function pushStatusCode(error: unknown): number | null {
  return typeof error === "object" && error && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode) || null
    : null;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown push error";
}
