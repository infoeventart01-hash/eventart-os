import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { supabaseConfig } from "./auth";
import { authCookieBridge } from "./supabase-cookies";

export function routeSupabase(request: NextRequest) {
  const config = supabaseConfig();
  if (!config.configured) throw new Error("EventArt authentication is not configured.");
  const bridge = authCookieBridge(request);
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: bridge.cookies,
  });
  return { client, finish: bridge.finish };
}
