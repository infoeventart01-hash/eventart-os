import { NextRequest, NextResponse } from "next/server";
import { routeSupabase } from "../../../../lib/supabase-route";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json() as { password?: string };
    if (!password || password.length < 10) return NextResponse.json({ error: "Use at least 10 characters for your new password." }, { status: 400 });
    const { client, finish } = routeSupabase(request);
    const { error } = await client.auth.updateUser({ password });
    if (error) return finish(NextResponse.json({ error: "This reset link is invalid or has expired. Request a new one." }, { status: 400 }));
    return finish(NextResponse.json({ ok: true }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update the password." }, { status: 503 }); }
}
