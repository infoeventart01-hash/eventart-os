import { NextRequest, NextResponse } from "next/server";
import { routeSupabase } from "../../../../lib/supabase-route";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json() as { email?: string };
    if (!email?.trim()) return NextResponse.json({ error: "Enter your email address." }, { status: 400 });
    const { client, finish } = routeSupabase(request);
    const origin = (process.env.EVENTART_APP_URL || request.nextUrl.origin).replace(/\/$/, "");
    await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${origin}/auth/callback?next=/reset-password` });
    return finish(NextResponse.json({ ok: true, message: "If that email belongs to an EventArt account, a reset link has been sent." }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to request a password reset." }, { status: 503 }); }
}
