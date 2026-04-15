import { NextResponse, type NextRequest } from "next/server";

import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client-to-server session bridge.
 *
 * Magic links sent from the Supabase dashboard use the implicit flow
 * (`#access_token=...` in the URL fragment). Fragments never reach the
 * server, so middleware can't pick them up, and calling setSession()
 * from the browser client doesn't reliably persist cookies that the
 * server-side client can read back.
 *
 * The client extracts tokens from the fragment and POSTs them here;
 * we call setSession() on a server-side Supabase client which writes
 * proper HttpOnly cookies via our standard cookie adapter. On the
 * next navigation middleware sees the session and the user is in.
 *
 * This endpoint is not itself authenticated — it has to be callable
 * before the session exists. Security rests on the fact that a valid
 * access_token is itself proof of identity (Supabase's own verify
 * endpoint issued it), so accepting it and turning it into cookies is
 * safe.
 */
export async function POST(request: NextRequest) {
  let body: { access_token?: string; refresh_token?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const { access_token, refresh_token } = body;
  if (!access_token || !refresh_token) {
    return NextResponse.json(
      { ok: false, error: "access_token and refresh_token are required." },
      { status: 400 },
    );
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });

  if (error || !data.session) {
    console.error("[auth.bridge] setSession failed", error?.message);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Session rejected." },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    user: { id: data.user?.id, email: data.user?.email },
  });
}
