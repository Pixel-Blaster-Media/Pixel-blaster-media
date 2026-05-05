import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type CookieStore = {
  get(name: string): { value: string } | undefined;
  set(options: { name: string; value: string } & CookieOptions): void;
};

/**
 * Server-side Supabase client tied to the current request's cookies.
 * Use from Server Components, Server Actions, and Route Handlers when you
 * want operations to run as the signed-in user (subject to RLS).
 */
export function getServerSupabase() {
  const cookieStore = cookies() as unknown as CookieStore;

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Server Components can't set cookies — safe to ignore here;
            // middleware/route handlers will refresh the session instead.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // See note above.
          }
        },
      },
    },
  );
}

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
