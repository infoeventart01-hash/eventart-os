declare module "@/lib/date-only.mjs" {
  export function normalizeDateOnly(value: unknown, fieldName?: string): string | undefined;
}

declare module "../../../lib/date-only.mjs" {
  export function normalizeDateOnly(value: unknown, fieldName?: string): string | undefined;
}

