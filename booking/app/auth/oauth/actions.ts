"use server";

import { redirect } from "next/navigation";

export async function startGoogleOAuth(_formData: FormData): Promise<void> {
  redirect("/auth/sign-in?audience=company&error=signup_disabled");
}

export async function startAppleOAuth(_formData: FormData): Promise<void> {
  redirect("/auth/sign-in?audience=company&error=signup_disabled");
}
