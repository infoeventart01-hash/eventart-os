import { NextResponse } from "next/server";
import { authenticationStatus } from "../../../../lib/auth";

export async function GET() {
  const status = authenticationStatus();
  const configured = status.present.supabaseUrl
    && status.supabaseUrlValid
    && status.present.publishableKey
    && status.present.serviceKey
    && status.present.ownerEmail
    && status.present.appUrl;
  return NextResponse.json(
    {
      configured,
      supabaseUrlValid: status.supabaseUrlValid,
      configurationError: status.configurationError,
      supabaseUrlPresent: status.present.supabaseUrl,
      publishableKeyPresent: status.present.publishableKey,
      serviceKeyPresent: status.present.serviceKey,
      ownerEmailPresent: status.present.ownerEmail,
      appUrlPresent: status.present.appUrl,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
