import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { authenticationStatus, cleanEnv } from "./lib/auth";
import { authCookieBridge, clearAllEventArtAuthCookies, hasDuplicateAuthCookies, logCookieDiagnostics } from "./lib/supabase-cookies";
import { developmentAuthBypassEnabled } from "./lib/dev-auth-bypass";

const publicPages = new Set(["/login", "/forgot-password", "/reset-password", "/auth/callback"]);
const publicApis = new Set(["/api/auth/config", "/api/auth/login", "/api/auth/forgot-password", "/api/auth/reset-password"]);
const publicPrefixes = ["/seating/", "/api/public-seating/", "/assets/", "/_next/"];
const publicFiles = new Set(["/favicon.ico", "/eventart-logo-transparent.png"]);
const teamViews = new Set(["Events", "Tasks", "Guests", "Seating Chart", "Vendors", "Design Studio"]);
const teamPaths = ["/events", "/tasks", "/guests", "/seating-chart", "/vendors", "/design-studio"];
const forwarded = ["x-eventart-user-id", "x-eventart-email", "x-eventart-name", "x-eventart-role", "x-eventart-client-id", "x-eventart-event-ids"];
const recentRedirects = new Map<string, { count: number; at: number }>();

function authSettings() {
  const status = authenticationStatus();
  return { url: status.values.url, key: status.values.publishableKey, serviceKey: status.values.serviceKey, valid: status.configured };
}
function isPublic(path: string) { return publicPages.has(path) || publicApis.has(path) || publicFiles.has(path) || publicPrefixes.some(prefix => path.startsWith(prefix)); }
function bypassesSessionValidation(path: string) { return publicApis.has(path) || path === "/auth/callback" || publicFiles.has(path) || publicPrefixes.some(prefix => path.startsWith(prefix)); }
function apiError(status: number, error: string) { return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } }); }
function safeSupabaseError(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { message?: unknown; code?: unknown; status?: unknown } : {};
  return {
    message: typeof candidate.message === "string" ? candidate.message : "Unknown Supabase error",
    code: typeof candidate.code === "string" ? candidate.code : "unknown",
    status: typeof candidate.status === "number" ? candidate.status : 0,
  };
}
function loginRedirect(request: NextRequest, reason?: string) {
  const url = request.nextUrl.clone(); url.pathname = "/login"; url.search = "";
  if (request.nextUrl.pathname !== "/" && request.nextUrl.pathname !== "/login") url.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (reason) url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}
function logRouteDecision(request: NextRequest, configured: boolean, sessionPresent: boolean, action: "allow" | "redirect" | "deny", redirectDestination = "") {
  const details = {
    pathname: request.nextUrl.pathname,
    publicRoute: isPublic(request.nextUrl.pathname),
    configurationPresent: configured,
    sessionPresent,
    action,
    redirectDestination,
  };
  if (process.env.NODE_ENV !== "production" && action === "redirect") {
    const key = `${details.pathname}->${redirectDestination}`;
    const now = Date.now();
    const previous = recentRedirects.get(key);
    const next = previous && now - previous.at < 2_000 ? { count: previous.count + 1, at: now } : { count: 1, at: now };
    recentRedirects.set(key, next);
    if (next.count >= 3) console.warn("EventArt repeated redirect decision", { pathname: details.pathname, redirectDestination, count: next.count });
  }
}
function bypassOwnerHeaders(request: NextRequest, ownerEmail: string) {
  const headers = new Headers(request.headers);
  forwarded.forEach(name => headers.delete(name));
  headers.set("x-eventart-user-id", "development-owner");
  headers.set("x-eventart-email", ownerEmail);
  headers.set("x-eventart-name", "EventArt Owner");
  headers.set("x-eventart-role", "owner");
  headers.set("x-eventart-client-id", "");
  headers.set("x-eventart-event-ids", "[]");
  headers.set("x-eventart-dev-auth-bypass", "true");
  return headers;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const bridge = authCookieBridge(request);
  const authConfig = authSettings();
  logCookieDiagnostics(request, "access-proxy");

  const configuredOwnerEmail = authenticationStatus().values.ownerEmail;
  const bypassOwnerEmail = cleanEnv(process.env.EVENTART_OWNER_EMAIL);
  const developmentBypass = developmentAuthBypassEnabled({
    hostname: request.nextUrl.hostname,
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.EVENTART_DEV_AUTH_BYPASS,
    configuredOwnerEmail,
    ownerEmail: bypassOwnerEmail,
  });

  if (developmentBypass && !isPublic(path)) {
    logRouteDecision(request, authConfig.valid, true, "allow");
    return bridge.finish(NextResponse.next({ request: { headers: bypassOwnerHeaders(request, bypassOwnerEmail) } }));
  }
  if (developmentBypass && path === "/login") {
    logRouteDecision(request, authConfig.valid, true, "redirect", "/");
    return bridge.finish(NextResponse.redirect(new URL("/", request.url)));
  }

  if (hasDuplicateAuthCookies(request)) {
    const redirectDestination = path.startsWith("/api/") || isPublic(path) ? "" : "/login?error=session-reset";
    const response = path.startsWith("/api/") ? apiError(401, "The previous authentication session was cleared. Sign in again.") : isPublic(path) ? NextResponse.next() : loginRedirect(request, "session-reset");
    clearAllEventArtAuthCookies(response, request);
    logRouteDecision(request, authConfig.valid, false, redirectDestination ? "redirect" : path.startsWith("/api/") ? "deny" : "allow", redirectDestination);
    return bridge.finish(response);
  }

  // A configuration error must always be renderable, even if a stale or newly
  // created Supabase session exists. This is the terminal state for setup errors.
  if (path === "/login" && request.nextUrl.searchParams.get("error") === "configuration") {
    logRouteDecision(request, authConfig.valid, false, "allow");
    return bridge.finish(NextResponse.next());
  }

  if (!authConfig.valid) {
    if (isPublic(path)) {
      logRouteDecision(request, false, false, "allow");
      return bridge.finish(NextResponse.next());
    }
    const destination = path.startsWith("/api/") ? "" : "/login?error=configuration";
    logRouteDecision(request, false, false, destination ? "redirect" : "deny", destination);
    return bridge.finish(path.startsWith("/api/") ? apiError(503, "EventArt authentication is not configured.") : loginRedirect(request, "configuration"));
  }

  // Auth-establishment routes, public seating, and static assets never depend
  // on management-profile authorization.
  if (bypassesSessionValidation(path)) {
    logRouteDecision(request, true, false, "allow");
    return bridge.finish(NextResponse.next());
  }

  const supabase = createServerClient(authConfig.url, authConfig.key, { cookies: bridge.cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (isPublic(path)) {
      logRouteDecision(request, true, false, "allow");
      return bridge.finish(NextResponse.next());
    }
    const destination = path.startsWith("/api/") ? "" : "/login";
    logRouteDecision(request, true, false, destination ? "redirect" : "deny", destination);
    return bridge.finish(path.startsWith("/api/") ? apiError(401, "Authentication is required.") : loginRedirect(request));
  }

  const ownerEmail = cleanEnv(process.env.EVENTART_OWNER_EMAIL).toLowerCase();
  const profileResult = await supabase.from("profiles").select("user_id,name,email,role,active,client_record_id").eq("user_id", user.id).maybeSingle();
  let profile = profileResult.data;
  if (profileResult.error) console.error("OWNER PROFILE LOOKUP ERROR", safeSupabaseError(profileResult.error));
  if (user.email?.toLowerCase() === ownerEmail && (!profile || profile.role !== "owner" || !profile.active)) {
    const adminKey = authConfig.serviceKey;
    if (!adminKey) {
      const destination = path.startsWith("/api/") ? "" : "/login?error=configuration";
      logRouteDecision(request, true, true, destination ? "redirect" : "deny", destination);
      return bridge.finish(path.startsWith("/api/") ? apiError(503, "The Owner profile cannot be initialized until server authentication is configured.") : loginRedirect(request, "configuration"));
    }
    const admin = createServerClient(authConfig.url, adminKey, { cookies: { getAll: () => [], setAll: () => undefined } });
    const inserted = await admin.from("profiles").upsert(
      { user_id: user.id, name: profile?.name || String(user.user_metadata?.name || user.email?.split("@")[0] || "Owner"), email: user.email, role: "owner", active: true, client_record_id: null },
      { onConflict: "user_id", ignoreDuplicates: false },
    ).select().single();
    if (inserted.error || !inserted.data) {
      console.error("OWNER PROFILE INITIALIZATION ERROR", safeSupabaseError(inserted.error));
      const destination = path.startsWith("/api/") ? "" : "/login?error=configuration";
      logRouteDecision(request, true, true, destination ? "redirect" : "deny", destination);
      return bridge.finish(path.startsWith("/api/") ? apiError(503, "The Owner profile could not be initialized.") : loginRedirect(request, "configuration"));
    }
    profile = inserted.data;
  }
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    const destination = path.startsWith("/api/") ? "" : "/login?error=inactive";
    logRouteDecision(request, true, true, destination ? "redirect" : "deny", destination);
    return bridge.finish(path.startsWith("/api/") ? apiError(403, "This EventArt account is inactive or has not been assigned a role.") : loginRedirect(request, "inactive"));
  }
  const { data: access } = await supabase.from("user_event_access").select("event_record_id").eq("user_id", user.id);

  if (path === "/login") {
    const destination = profile.role === "client" ? "/client-portal" : "/";
    logRouteDecision(request, true, true, "redirect", destination);
    return bridge.finish(NextResponse.redirect(new URL(destination, request.url)));
  }
  if (profile.role === "client" && !path.startsWith("/client-portal") && !path.startsWith("/api/client-portal") && !isPublic(path)) {
    const destination = path.startsWith("/api/") ? "" : "/client-portal";
    logRouteDecision(request, true, true, destination ? "redirect" : "deny", destination);
    return bridge.finish(path.startsWith("/api/") ? apiError(403, "Client accounts cannot access management APIs.") : NextResponse.redirect(new URL(destination, request.url)));
  }
  if (profile.role === "team" && !path.startsWith("/api/")) {
    const rootView = path === "/" ? request.nextUrl.searchParams.get("view") : null;
    const allowed = (path === "/" && rootView && teamViews.has(rootView)) || teamPaths.some(prefix => path.startsWith(prefix));
    if (!allowed) {
      logRouteDecision(request, true, true, "redirect", "/?view=Events");
      return bridge.finish(NextResponse.redirect(new URL("/?view=Events", request.url)));
    }
  }

  const headers = new Headers(request.headers);
  forwarded.forEach(name => headers.delete(name));
  headers.set("x-eventart-user-id", profile.user_id);
  headers.set("x-eventart-email", profile.email || user.email || "");
  headers.set("x-eventart-name", profile.name || "EventArt User");
  headers.set("x-eventart-role", profile.role);
  headers.set("x-eventart-client-id", profile.client_record_id || "");
  headers.set("x-eventart-event-ids", JSON.stringify((access || []).map(row => row.event_record_id)));
  logRouteDecision(request, true, true, "allow");
  return bridge.finish(NextResponse.next({ request: { headers } }));
}

export const config = { matcher: ["/((?!.*\\.[a-zA-Z0-9]+$).*)", "/api/:path*"] };
