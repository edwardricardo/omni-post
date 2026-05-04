/**
 * @file route.ts
 * @description Route Handler that clears the admin-session cookie and redirects to /login.
 * Called by the dashboard layout when token verification fails (401/expired).
 * Route Handlers CAN modify cookies — Server Components cannot.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "../../../lib/env";

export async function GET() {
  const cookieStore = await cookies();
  cookieStore.delete("admin-session");
  cookieStore.delete("admin-refresh");
  cookieStore.delete("admin-csrf");
  return NextResponse.redirect(new URL("/login", env.NEXT_PUBLIC_URL || "http://localhost:3100"));
}
