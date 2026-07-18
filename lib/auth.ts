import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { authenticationStatus } from "./auth-config";
export { AUTH_ENV_NAMES, authenticationStatus, cleanEnv } from "./auth-config";

export type EventArtRole = "owner" | "team" | "client";
export type EventArtIdentity = {
  userId: string;
  email: string;
  name: string;
  role: EventArtRole;
  clientRecordId?: string;
  eventRecordIds: string[];
};

export function supabaseConfig() {
  const status = authenticationStatus();
  return { url: status.values.url, publishableKey: status.values.publishableKey, secretKey: status.values.serviceKey, configured: status.configured, adminConfigured: status.serverConfigured };
}

export function adminClient() {
  const config = supabaseConfig();
  if (!config.adminConfigured) throw new Error("EventArt server administration is not configured.");
  return createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function identityFromRequest(request: NextRequest): EventArtIdentity | null {
  const role = request.headers.get("x-eventart-role") as EventArtRole | null;
  const userId = request.headers.get("x-eventart-user-id") || "";
  if (!userId || !role || !["owner", "team", "client"].includes(role)) return null;
  let eventRecordIds: string[] = [];
  try { eventRecordIds = JSON.parse(request.headers.get("x-eventart-event-ids") || "[]"); } catch { eventRecordIds = []; }
  return {
    userId,
    role,
    email: request.headers.get("x-eventart-email") || "",
    name: request.headers.get("x-eventart-name") || "EventArt User",
    clientRecordId: request.headers.get("x-eventart-client-id") || undefined,
    eventRecordIds: Array.isArray(eventRecordIds) ? eventRecordIds.filter(value => /^rec[A-Za-z0-9]{14}$/.test(value)) : [],
  };
}

export function requireIdentity(request: NextRequest, roles?: EventArtRole[]) {
  const identity = identityFromRequest(request);
  if (!identity) return { error: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) };
  if (roles && !roles.includes(identity.role)) return { error: NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403 }) };
  return { identity };
}
