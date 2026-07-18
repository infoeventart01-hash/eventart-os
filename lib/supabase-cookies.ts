import { NextRequest, NextResponse } from "next/server";
import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

export type PendingAuthCookie = { name: string; value: string; options: Record<string, unknown> };

const obsoleteAuthCookies = new Set([
  "eventart-auth",
  "eventart-session",
  "eventart-user",
  "sb-access-token",
  "sb-refresh-token",
  "supabase-auth-token",
]);
const supabaseAuthCookie = /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/i;
const cleanupPaths = ["/", "/login", "/api", "/auth"];

function secureRequest(request: NextRequest) {
  return request.nextUrl.protocol === "https:";
}

function normalizedOptions(request: NextRequest, options: Record<string, unknown> = {}) {
  const normalized: Record<string, unknown> = { ...options, path: "/", sameSite: "lax", secure: secureRequest(request) };
  delete normalized["domain"];
  return normalized as Partial<ResponseCookie>;
}

export function cookieHeaderDiagnostics(request: NextRequest) {
  const header = request.headers.get("cookie") || "";
  const names = header.split(";").map(part => part.trim().split("=", 1)[0]).filter(Boolean);
  const counts = new Map<string, number>();
  names.forEach(name => counts.set(name, (counts.get(name) || 0) + 1));
  const duplicateNames = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
  return { count: names.length, bytes: new TextEncoder().encode(header).byteLength, names: [...new Set(names)], duplicateNames };
}

export function logCookieDiagnostics(request: NextRequest, context: string, force = false) {
  const diagnostics = cookieHeaderDiagnostics(request);
  if (force || diagnostics.bytes > 4096 || diagnostics.duplicateNames.length) {
    console.info("EventArt auth cookie diagnostics", { context, ...diagnostics });
  }
  return diagnostics;
}

export function hasDuplicateAuthCookies(request: NextRequest) {
  return cookieHeaderDiagnostics(request).duplicateNames.some(name => obsoleteAuthCookies.has(name) || supabaseAuthCookie.test(name));
}

function expireCookie(response: NextResponse, request: NextRequest, name: string) {
  cleanupPaths.forEach(path => response.cookies.set(name, "", { path, expires: new Date(0), maxAge: 0, httpOnly: true, sameSite: "lax", secure: secureRequest(request) }));
}

export function clearObsoleteAuthCookies(response: NextResponse, request: NextRequest) {
  const names = request.cookies.getAll().map(cookie => cookie.name);
  [...new Set(names.filter(name => obsoleteAuthCookies.has(name)))].forEach(name => expireCookie(response, request, name));
  return response;
}

export function clearAllEventArtAuthCookies(response: NextResponse, request: NextRequest) {
  const names = request.cookies.getAll().map(cookie => cookie.name);
  [...new Set(names.filter(name => obsoleteAuthCookies.has(name) || supabaseAuthCookie.test(name)))].forEach(name => expireCookie(response, request, name));
  return response;
}

export function applyAuthCookies(response: NextResponse, request: NextRequest, pending: PendingAuthCookie[]) {
  const latest = new Map<string, PendingAuthCookie>();
  pending.forEach(cookie => latest.set(cookie.name, cookie));
  latest.forEach(({ name, value, options }) => response.cookies.set(name, value, normalizedOptions(request, options)));
  return clearObsoleteAuthCookies(response, request);
}

export function authCookieBridge(request: NextRequest) {
  const pending: PendingAuthCookie[] = [];
  return {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies: PendingAuthCookie[]) => {
        cookies.forEach(cookie => {
          request.cookies.set(cookie.name, cookie.value);
          pending.push({ ...cookie, options: cookie.options || {} });
        });
      },
    },
    finish: <T>(response: NextResponse<T>) => {
      response.headers.set("Cache-Control", "private, no-store");
      return applyAuthCookies(response, request, pending);
    },
  };
}
