declare module "@/lib/payment-contract.mjs" {
  export const PAYMENT_TYPES: readonly string[];
  export const PAYMENT_METHODS: readonly string[];
  export const PAYMENT_STATUSES: readonly string[];
  export function normalizePaymentType(value: unknown): string;
  export function validatePaymentDraft(draft: {
    event: string; budget: string; type: string; other: string; amount: string;
    date: string; due: string; method: string; status: string; reference: string; notes: string;
  }): Record<string, string>;
  export function buildPaymentFields(
    draft: {
      event: string; budget: string; type: string; other: string; amount: string;
      date: string; due: string; method: string; status: string; reference: string; notes: string;
    },
    context?: { clientId?: string; proposalNumber?: string; recordedBy?: string },
  ): Record<string, unknown>;
  export function readPaymentResponse(response: Response): Promise<Record<string, unknown>>;
}
