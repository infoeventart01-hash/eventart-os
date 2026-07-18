import { NextRequest, NextResponse } from "next/server";
import { routeSupabase } from "../../../../lib/supabase-route";
import { clearAllEventArtAuthCookies, logCookieDiagnostics } from "../../../../lib/supabase-cookies";
import { logAuthStep, safeAuthError } from "../../../../lib/auth-log";

export async function POST(request: NextRequest) {
  try {
    logAuthStep("logout.request.received");
    logCookieDiagnostics(request, "logout");
    const { client, finish } = routeSupabase(request);
    logAuthStep("logout.provider.sign_out_started");
    const { error } = await client.auth.signOut();
    if (error) throw error;
    logAuthStep("logout.provider.sign_out_succeeded");
    const response = finish(NextResponse.json({ ok: true }));
    logAuthStep("logout.response.cookies_cleared");
    return clearAllEventArtAuthCookies(response, request);
  } catch (error) {
    logAuthStep("logout.request.failed", safeAuthError(error));
    return NextResponse.json({ error: "Unable to sign out." }, { status: 503 });
  }
}
