import { NextResponse } from "next/server";

import {
  BETA_INVITE_COOKIE,
  getActiveBetaCompanyInvite,
} from "@/lib/platform/beta-invites";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  const invite = await getActiveBetaCompanyInvite(token);
  const destination = new URL("/beta/onboarding", url.origin);
  if (!invite) destination.searchParams.set("invalid", "1");

  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  if (invite) {
    response.cookies.set(BETA_INVITE_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/beta",
      expires: new Date(invite.expiresAt),
    });
  } else {
    response.cookies.set(BETA_INVITE_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/beta",
      maxAge: 0,
    });
  }
  return response;
}
