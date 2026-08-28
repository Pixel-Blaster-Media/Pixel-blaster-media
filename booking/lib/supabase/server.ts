import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createBoundedSupabaseAuthFetch } from "@/lib/auth/bounded-supabase-auth-fetch";
import {
  getSupabaseSdkCookieMutations,
  getSupabaseSdkVisibleCookies,
} from "@/lib/auth/supabase-server-cookie-adapter";
import { createSupabaseRefreshCookieTransaction } from "@/lib/auth/supabase-refresh-cookie-transaction";
import type { Database } from "./database.types";

type SupabaseRefreshFailureKind = "unavailable" | "terminal";
const refreshFailureStates = new WeakMap<
  object,
  { kind: SupabaseRefreshFailureKind | null }
>();

export function getServerSupabaseRefreshFailureKind(
  client: object,
): SupabaseRefreshFailureKind | null {
  return refreshFailureStates.get(client)?.kind ?? null;
}

type CookieStore = {
  getAll(): Array<{ name: string; value: string }>;
  set(options: { name: string; value: string } & CookieOptions): void;
};

/**
 * Server-side Supabase client tied to the current request's cookies.
 * React request caching shares one mutable Auth session across every consumer
 * in an RSC render. Outside an RSC dispatcher (for example, Route Handlers and
 * Server Actions), React invokes the factory directly and cookie writes remain
 * available to the framework runtime.
 */
export const getServerSupabase = cache(async function getServerSupabase() {
  const cookieStore = (await cookies()) as unknown as CookieStore;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  let observedCookies = cookieStore.getAll();
  const commitCookieMutations = (
    mutations: readonly {
      name: string;
      value: string;
      options: CookieOptions;
    }[],
  ) => {
    try {
      for (const { name, value, options } of mutations) {
        cookieStore.set({ name, value, ...options });
        observedCookies = observedCookies.filter(
          (cookie) => cookie.name !== name,
        );
        if (value) observedCookies.push({ name, value });
      }
    } catch {
      // RSCs cannot persist cookies. The request-cached client still retains
      // a refreshed session in memory for the current render.
    }
  };
  const refreshTransaction = createSupabaseRefreshCookieTransaction(
    supabaseUrl,
    commitCookieMutations,
  );

  const refreshState: { kind: SupabaseRefreshFailureKind | null } = {
    kind: null,
  };
  const client = createServerClient<Database>(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        secure: process.env.NODE_ENV === "production",
      },
      global: {
        fetch: createBoundedSupabaseAuthFetch(supabaseUrl, globalThis.fetch, {
          onTokenExchangeFailure(kind) {
            refreshState.kind = kind;
            refreshTransaction.failRefresh(kind);
          },
          onTokenExchangeSuccess() {
            refreshState.kind = null;
          },
          onRefreshTokenCandidate: refreshTransaction.acceptRefreshCandidate,
          onAuthUserProof: refreshTransaction.processAuthUserProof,
        }),
      },
      cookies: {
        getAll() {
          return getSupabaseSdkVisibleCookies(observedCookies, supabaseUrl);
        },
        setAll(
          mutations: Array<{
            name: string;
            value: string;
            options: CookieOptions;
          }>,
        ) {
          const safeMutations = getSupabaseSdkCookieMutations(
            observedCookies,
            mutations,
            supabaseUrl,
          );
          commitCookieMutations(
            refreshTransaction.processCookieMutations(safeMutations),
          );
        },
      },
    },
  );
  refreshFailureStates.set(client, refreshState);
  return client;
});

/**
 * Service-role Supabase client. Bypasses RLS — use sparingly and only on
 * the server (webhook handlers, cron jobs, admin-only actions). Never
 * import this into a Client Component.
 */
export function getServiceSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. This client may only be constructed on the server with the service-role key configured.",
    );
  }
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
