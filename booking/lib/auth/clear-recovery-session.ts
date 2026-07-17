import "server-only";

import { cookies } from "next/headers";

import { RECOVERY_GRANT_COOKIE } from "@/lib/auth/recovery-flow";
import type { getServerSupabase } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof getServerSupabase>>;

export async function clearRecoverySession(
  supabase: ServerSupabase | null,
): Promise<void> {
  if (supabase) {
    try {
      const signedOut = await supabase.auth.signOut();
      if (signedOut.error) {
        console.error(
          "[auth/reset] remote session cleanup failed",
          signedOut.error.message,
        );
      }
    } catch (error) {
      console.error(
        "[auth/reset] session cleanup threw",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  try {
    const cookieStore = await cookies();
    for (const cookie of cookieStore.getAll()) {
      if (/^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name)) {
        cookieStore.set(cookie.name, "", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        });
      }
    }
    cookieStore.set(RECOVERY_GRANT_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth/reset/confirm",
      maxAge: 0,
    });
  } catch (error) {
    console.error(
      "[auth/reset] local cookie cleanup failed",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
