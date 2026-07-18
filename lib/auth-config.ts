export function cleanEnv(value: string | undefined) {
  return value?.trim().replace(/^(['"])(.*)\1$/, "$2").trim() || "";
}

export const AUTH_ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "EVENTART_OWNER_EMAIL",
  "EVENTART_APP_URL",
] as const;

export function normalizeSupabaseUrl(value: string | undefined) {
  return cleanEnv(value)
    .replace(/\/(?:rest|auth)\/v1\/?$/i, "")
    .replace(/\/+$/, "");
}

export function validSupabaseProjectUrl(value: string) {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value);
}

export function authenticationStatus(environment: NodeJS.ProcessEnv = process.env) {
  const values = {
    url: normalizeSupabaseUrl(environment.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey: cleanEnv(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) || cleanEnv(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    serviceKey: cleanEnv(environment.SUPABASE_SECRET_KEY) || cleanEnv(environment.SUPABASE_SERVICE_ROLE_KEY),
    ownerEmail: cleanEnv(environment.EVENTART_OWNER_EMAIL),
    appUrl: cleanEnv(environment.EVENTART_APP_URL),
  };
  const present = {
    supabaseUrl: Boolean(values.url),
    publishableKey: Boolean(values.publishableKey),
    serviceKey: Boolean(values.serviceKey),
    ownerEmail: Boolean(values.ownerEmail),
    appUrl: Boolean(values.appUrl),
  };
  const configured = present.supabaseUrl
    && validSupabaseProjectUrl(values.url)
    && present.publishableKey
    && present.serviceKey
    && present.ownerEmail
    && present.appUrl;
  const missing: string[] = [];
  if (!present.supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!present.publishableKey) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!present.serviceKey) missing.push("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  if (!present.ownerEmail) missing.push("EVENTART_OWNER_EMAIL");
  if (!present.appUrl) missing.push("EVENTART_APP_URL");
  return {
    configured,
    serverConfigured: configured,
    supabaseUrlValid: validSupabaseProjectUrl(values.url),
    configurationError: present.supabaseUrl && !validSupabaseProjectUrl(values.url) ? "invalid_supabase_project_url" : null,
    missing,
    present,
    values,
  };
}
