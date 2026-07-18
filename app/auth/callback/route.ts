import { NextRequest, NextResponse } from "next/server";
import { routeSupabase } from "../../../lib/supabase-route";
import { logAuthStep, safeAuthError } from "../../../lib/auth-log";

export async function GET(request: NextRequest) {
  logAuthStep("callback.request.received");
  const code = request.nextUrl.searchParams.get("code");
  const requested = request.nextUrl.searchParams.get("next") || "/";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  if (!code) {
    logAuthStep("callback.request.rejected", { reason: "missing_code" });
    return NextResponse.redirect(new URL("/login?error=invalid-link", request.url));
  }
  try {
    const { client, finish } = routeSupabase(request);
    logAuthStep("callback.session_exchange_started");
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      logAuthStep("callback.session_exchange_failed", safeAuthError(error));
      return finish(NextResponse.redirect(new URL("/login?error=invalid-link", request.url)));
    }
    logAuthStep("callback.session_exchange_succeeded");
    return finish(NextResponse.redirect(new URL(next, request.url)));
  } catch (error) {
    logAuthStep("callback.request.failed", safeAuthError(error));
    return NextResponse.redirect(new URL("/login?error=configuration", request.url));
  }
}
