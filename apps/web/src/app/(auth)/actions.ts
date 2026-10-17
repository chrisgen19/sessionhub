"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";

/** Sign-out only; sign-in/up use the rate-limited HTTP endpoints via the auth client. */
export async function signOutAction(): Promise<void> {
  const requestHeaders = await headers();
  await getAuth().api.signOut({ headers: requestHeaders });
  redirect("/");
}
