"use server";

import type { Provider } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerSupabase } from "@/lib/supabase/server";

type OAuthProvider = Extract<Provider, "google" | "apple">;

export async function startGoogleOAuth(formData: FormData): Promise<void> {
  await startOAuth("google", formData);
}

export async function startAppleOAuth(formData: FormData): Promise<void> {
  await startOAuth("apple", formData);
}

async function startOAuth(
  provider: OAuthProvider,
  formData: FormData,
): Promise<void> {
  const mode = String(formData.get("mode") ?? "sign-in");
  const next =
    mode === "signup"
      ? "/start/oauth/complete"
      : safeNextPath(String(formData.get("next") ?? "/admin"));
  const failedPath = mode === "signup" ? "/start" : "/auth/sign-in";

  const supabase = await getServerSupabase();
  const callback = new URL("/auth/callback", await getAppOrigin());
  callback.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: callback.toString(),
      queryParams:
        provider === "google" ? { prompt: "select_account" } : undefined,
    },
  });

  if (error || !data.url) {
    console.warn(
      `[auth] ${provider} OAuth start failed`,
      error?.message ?? "missing provider URL",
    );
    const failed = new URL(failedPath, await getAppOrigin());
    failed.searchParams.set("oauth_error", provider);
    redirect(failed.toString());
  }

  redirect(data.url);
}

async function getAppOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  }

  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host ?? "localhost:3000"}`;
}

function safeNextPath(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/admin";
  }
  if (next.startsWith("/auth/") || next.startsWith("/start/oauth/")) {
    return "/admin";
  }
  return next;
}
