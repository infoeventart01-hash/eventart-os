import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { authenticationStatus, normalizeSupabaseUrl, validSupabaseProjectUrl } from "../lib/auth-config.ts";
import { createClient } from "@supabase/supabase-js";
import { developmentAuthBypassEnabled } from "../lib/dev-auth-bypass.ts";

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("renders the branded EventArt login without exposing the management shell", async () => {
  const response = await (await worker()).fetch(new Request("http://localhost/login", { headers: { accept: "text/html" } }), env, ctx);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /EventArt \| Luxury Event Design &amp; Styling/i);
  assert.match(html, /eventart-logo-transparent\.png/i);
  assert.match(html, /Welcome to EventArt/i);
  assert.doesNotMatch(html, /Your site is taking shape|Codex is working|Starter Project/i);
});

test("anonymous management routes redirect to login", async () => {
  const response = await (await worker()).fetch(new Request("http://localhost/events", { redirect: "manual" }), env, ctx);
  assert.ok([302, 303, 307, 308].includes(response.status));
  assert.match(response.headers.get("location") || "", /\/login/);
});

test("public seating excludes unassigned guests and financials accept only received states", async () => {
  const [seating, financials] = await Promise.all([
    readFile(new URL("../app/api/public-seating/[eventId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/airtable/financials.ts", import.meta.url), "utf8"),
  ]);
  assert.match(seating, /guest\.name && guest\.table/);
  assert.match(financials, /new Set\(\["Paid", "Completed", "Received"\]\)/);
  assert.match(financials, /Math\.max\(0, totalContract - amountPaid\)/);
});

test("uploads are bounded, type-checked and use the Airtable attachment endpoint", async () => {
  const upload = await readFile(new URL("../app/api/airtable/upload/route.ts", import.meta.url), "utf8");
  assert.match(upload, /const maxBytes=5\*1024\*1024/);
  assert.match(upload, /const maxRequestBytes=6\*1024\*1024/);
  assert.match(upload, /uploadAttachment/);
  assert.match(upload, /request\.formData\(\)/);
  assert.doesNotMatch(upload, /console\.(?:log|error)\([^\n]*(?:TOKEN|filename|file contents)/);
});

test("management routes require a server-validated Supabase session", async () => {
  const accessProxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(accessProxy, /createServerClient/);
  assert.match(accessProxy, /auth\.getUser\(\)/);
  assert.match(accessProxy, /x-eventart-role/);
  assert.match(accessProxy, /user_event_access/);
  assert.match(accessProxy, /publicPrefixes.*\/seating\//s);
  const response = await (await worker()).fetch(new Request("https://eventart.example/"), env, ctx);
  assert.ok([302, 303, 307, 308].includes(response.status));
  assert.match(response.headers.get("location") || "", /\/login/);
  const api = await (await worker()).fetch(new Request("https://eventart.example/api/airtable?table=Events"), env, ctx);
  assert.equal(api.status, 503);
  assert.match(await api.text(), /authentication is not configured/i);
});

test("role enforcement and redacted client portal are implemented server-side", async () => {
  const [airtable, portal, users] = await Promise.all([
    readFile(new URL("../app/api/airtable/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/client-portal/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/users/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(airtable, /teamReadable/);
  assert.match(airtable, /teamRecordAllowed/);
  assert.match(portal, /Visible to Client/);
  assert.doesNotMatch(portal, /Internal Cost|Profit Margin|Markup/);
  assert.match(users, /inviteUserByEmail/);
  assert.match(users, /requireIdentity\(request,\["owner"\]\)/);
});

test("authentication configuration, Owner bootstrap, reset, persistence and logout are wired", async () => {
  const [login, configRoute, authConfig, authEnvironment, accessProxy, reset, callback, logout] = await Promise.all([
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/config/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/forgot-password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(login, /fetch\("\/api\/auth\/config"/);
  assert.match(login, /configured === false/);
  assert.match(configRoute, /authenticationStatus/);
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "EVENTART_OWNER_EMAIL", "EVENTART_APP_URL"]) assert.match(`${authConfig}\n${authEnvironment}`, new RegExp(name));
  assert.match(accessProxy, /profile\.role !== "owner"/);
  assert.match(accessProxy, /role: "owner", active: true/);
  assert.match(accessProxy, /bridge\.finish/);
  assert.match(reset, /resetPasswordForEmail/);
  assert.match(callback, /exchangeCodeForSession/);
  assert.match(logout, /auth\.signOut\(\)/);
  const status = await (await worker()).fetch(new Request("https://eventart.example/api/auth/config"), env, ctx);
  assert.equal(status.status, 200);
  const body = await status.json();
  assert.equal(typeof body.configured, "boolean");
  for (const flag of ["supabaseUrlPresent", "publishableKeyPresent", "serviceKeyPresent", "ownerEmailPresent", "appUrlPresent"]) assert.equal(typeof body[flag], "boolean");
  assert.equal("serviceKey" in body, false);
  assert.equal("publishableKey" in body, false);
  assert.equal("supabaseUrl" in body, false);
  const configuredEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: "https://eventart-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key_1234567890",
    SUPABASE_SECRET_KEY: "sb_secret_test_key_1234567890",
    EVENTART_OWNER_EMAIL: "infoeventart01@gmail.com",
    EVENTART_APP_URL: "https://eventart.example",
  };
  const configuredStatus = authenticationStatus(configuredEnvironment);
  assert.deepEqual({ configured: configuredStatus.configured, missing: configuredStatus.missing }, { configured: true, missing: [] });
  const publicOnlyStatus = authenticationStatus({
    NEXT_PUBLIC_SUPABASE_URL: configuredEnvironment.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: configuredEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  assert.equal(publicOnlyStatus.configured, false);
  assert.deepEqual(publicOnlyStatus.missing, ["SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY", "EVENTART_OWNER_EMAIL", "EVENTART_APP_URL"]);
  const legacyEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: "https://eventart-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy_anon_key_12345678901234567890",
    SUPABASE_SERVICE_ROLE_KEY: "legacy_service_key_1234567890123456",
    EVENTART_OWNER_EMAIL: "infoeventart01@gmail.com",
    EVENTART_APP_URL: "https://eventart.example",
  };
  assert.equal(authenticationStatus(legacyEnvironment).configured, true);
  assert.equal(authenticationStatus({}).configured, false);
});

test("Supabase SSR cookies are normalized, deduplicated and cleared on logout", async () => {
  const [cookieHelper, accessProxy, routeClient, loginRoute, loginPage, logoutRoute] = await Promise.all([
    readFile(new URL("../lib/supabase-cookies.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase-route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(cookieHelper, /path: "\/", sameSite: "lax", secure:/);
  assert.match(cookieHelper, /delete normalized\["domain"\]/);
  assert.match(cookieHelper, /latest = new Map/);
  assert.match(cookieHelper, /eventart-session/);
  assert.match(cookieHelper, /sb-access-token/);
  assert.match(cookieHelper, /supabaseAuthCookie/);
  assert.match(accessProxy, /authCookieBridge/);
  assert.match(accessProxy, /hasDuplicateAuthCookies/);
  assert.doesNotMatch(accessProxy, /response\.cookies\.getAll\(\)\.forEach/);
  assert.match(routeClient, /authCookieBridge/);
  assert.equal((loginRoute.match(/signInWithPassword/g) || []).length, 1);
  assert.match(loginPage, /if \(busy \|\| configured === false\) return/);
  assert.match(logoutRoute, /auth\.signOut\(\)/);
  assert.match(logoutRoute, /clearAllEventArtAuthCookies/);
  const runtime = await worker();
  const obsolete = await runtime.fetch(new Request("https://eventart.example/login", { headers: { cookie: "eventart-session=legacy; sb-access-token=legacy" } }), env, ctx);
  const obsoleteSetCookie = obsolete.headers.get("set-cookie") || "";
  assert.match(obsoleteSetCookie, /eventart-session=/);
  assert.match(obsoleteSetCookie, /sb-access-token=/);
  const duplicate = await runtime.fetch(new Request("https://eventart.example/events", { redirect: "manual", headers: { cookie: "sb-test-auth-token=first; sb-test-auth-token=second" } }), env, ctx);
  assert.match(duplicate.headers.get("location") || "", /\/login.*session-reset/);
  assert.match(duplicate.headers.get("set-cookie") || "", /sb-test-auth-token=/);
});

test("authentication routing has one guard and configuration errors cannot self-redirect", async () => {
  const [accessProxy, dashboard, loginPage] = await Promise.all([
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(accessProxy, /path === "\/login" && request\.nextUrl\.searchParams\.get\("error"\) === "configuration"/);
  assert.match(accessProxy, /bypassesSessionValidation/);
  assert.match(accessProxy, /EventArt repeated redirect decision/);
  assert.doesNotMatch(dashboard, /response\.status===401\)\{window\.location\.assign\("\/login"\)/);
  assert.match(loginPage, /fetch\("\/api\/auth\/me"/);
  const runtime = await worker();
  const configuration = await runtime.fetch(new Request("https://eventart.example/login?error=configuration", { redirect: "manual" }), env, ctx);
  assert.equal(configuration.status, 200);
  assert.equal(configuration.headers.get("location"), null);
});

test("development Owner bypass is localhost-only and impossible in production", async () => {
  const owner = "owner@example.com";
  const enabled = { hostname: "localhost", nodeEnv: "development", flag: "true", configuredOwnerEmail: owner, ownerEmail: owner };
  assert.equal(developmentAuthBypassEnabled(enabled), true);
  assert.equal(developmentAuthBypassEnabled({ ...enabled, flag: "false" }), false);
  assert.equal(developmentAuthBypassEnabled({ ...enabled, hostname: "eventart.example" }), false);
  assert.equal(developmentAuthBypassEnabled({ ...enabled, nodeEnv: "production" }), false);
  assert.equal(developmentAuthBypassEnabled({ ...enabled, configuredOwnerEmail: "different@example.com" }), false);
  const [accessProxy, dashboard, exampleEnvironment] = await Promise.all([
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(accessProxy, /developmentAuthBypassEnabled/);
  assert.match(accessProxy, /x-eventart-dev-auth-bypass/);
  assert.match(dashboard, /Development authentication bypass is active/);
  assert.match(exampleEnvironment, /^EVENTART_DEV_AUTH_BYPASS=false$/m);
});

test("Supabase project URLs are normalized before authentication requests", async () => {
  const baseUrl = "https://eventart-project.supabase.co";
  assert.equal(normalizeSupabaseUrl(`  ${baseUrl}/rest/v1/  `), baseUrl);
  assert.equal(normalizeSupabaseUrl(`${baseUrl}/auth/v1`), baseUrl);
  assert.equal(normalizeSupabaseUrl(`${baseUrl}///`), baseUrl);
  assert.equal(validSupabaseProjectUrl(baseUrl), true);
  assert.equal(validSupabaseProjectUrl("https://example.com"), false);
  const status = authenticationStatus({
    NEXT_PUBLIC_SUPABASE_URL: `${baseUrl}/rest/v1`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-test-value",
    SUPABASE_SERVICE_ROLE_KEY: "service-test-value",
    EVENTART_OWNER_EMAIL: "owner@example.com",
    EVENTART_APP_URL: "http://localhost:5174",
  });
  assert.equal(status.configured, true);
  assert.equal(status.values.url, baseUrl);
  assert.equal(status.supabaseUrlValid, true);
  const invalidStatus = authenticationStatus({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.com/rest/v1",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-test-value",
    SUPABASE_SERVICE_ROLE_KEY: "service-test-value",
    EVENTART_OWNER_EMAIL: "owner@example.com",
    EVENTART_APP_URL: "http://localhost:5174",
  });
  assert.equal(invalidStatus.configured, false);
  assert.equal(invalidStatus.supabaseUrlValid, false);
  assert.equal(invalidStatus.configurationError, "invalid_supabase_project_url");
  let requestedUrl = "";
  const client = createClient(status.values.url, status.values.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Test request" }), { status: 400, headers: { "Content-Type": "application/json" } });
    } },
  });
  await client.auth.signInWithPassword({ email: "owner@example.com", password: "test-only-password" });
  assert.match(requestedUrl, /^https:\/\/eventart-project\.supabase\.co\/auth\/v1\/token\?grant_type=password$/);
});

test("Supabase authentication migration matches the EventArt authorization contract", async () => {
  const [migration, accessProxy, meRoute] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607170001_create_auth_profiles.sql", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/me/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /create table if not exists public\.profiles/);
  assert.match(migration, /role in \('owner', 'team', 'client'\)/);
  assert.match(migration, /create table if not exists public\.user_event_access/);
  assert.match(migration, /references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /primary key \(user_id, event_record_id\)/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /auth\.uid\(\) = user_id/g);
  assert.match(migration, /set_eventart_profile_updated_at/);
  assert.match(accessProxy, /onConflict: "user_id"/);
  assert.match(accessProxy, /OWNER PROFILE INITIALIZATION ERROR/);
  assert.match(meRoute, /requireIdentity/);
});
