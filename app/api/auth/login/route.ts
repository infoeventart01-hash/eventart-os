import { NextRequest, NextResponse } from "next/server";
import { routeSupabase } from "../../../../lib/supabase-route";
import { logCookieDiagnostics } from "../../../../lib/supabase-cookies";
import { logAuthStep, safeAuthError } from "../../../../lib/auth-log";

export async function POST(request: NextRequest) {
  try {
    logAuthStep("login.request.received");
    logCookieDiagnostics(request, "login");
    const { email, password } = await request.json() as { email?: string; password?: string };
    if (!email?.trim() || !password) {
      logAuthStep("login.request.rejected", { reason: "missing_fields" });
      return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    }
    logAuthStep("login.request.validated", { emailPresent: true, passwordPresent: true });
    const { client, finish } = routeSupabase(request);
    logAuthStep("login.provider.sign_in_started");
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) {
      logAuthStep("login.provider.sign_in_failed", error ? safeAuthError(error) : { reason: "missing_user" });
      const credentialFailure = error?.code === "invalid_credentials" || error?.code === "email_not_confirmed" || error?.status === 400;
      const message = credentialFailure ? "The email or password is incorrect, or the account has not been verified." : "The authentication provider is temporarily unavailable. Please try again.";
      return finish(NextResponse.json({ error: message }, { status: credentialFailure ? 401 : 503 }));
    }
    logAuthStep("login.provider.sign_in_succeeded", { userPresent: true, sessionPresent: Boolean(data.session) });
    logAuthStep("login.response.success");
    return finish(NextResponse.json({ ok: true }));
  } catch (error) {
    logAuthStep("login.request.failed", safeAuthError(error));
    return NextResponse.json({ error: "Unable to sign in because the authentication service is unavailable." }, { status: 503 });
  }
}
