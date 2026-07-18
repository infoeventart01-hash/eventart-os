import { NextRequest, NextResponse } from "next/server";
import { requireIdentity } from "../../../../lib/auth";

export async function GET(request: NextRequest) {
  const auth = requireIdentity(request);
  if (auth.error) return auth.error;
  const { name, email, role } = auth.identity!;
  const developmentAuthBypass = request.headers.get("x-eventart-dev-auth-bypass") === "true";
  return NextResponse.json({ name, email, role, developmentAuthBypass }, { headers: { "Cache-Control": "private, no-store" } });
}
