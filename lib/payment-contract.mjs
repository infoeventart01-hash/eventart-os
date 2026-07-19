export const PAYMENT_TYPES = Object.freeze([
  "Booking Deposit",
  "Progress Payment",
  "Final Payment",
  "Rental Deposit",
  "Rental Balance",
  "Refund",
  "Damage Charge",
  "Other",
  "Design Deposit",
]);

export const PAYMENT_METHODS = Object.freeze([
  "Cash",
  "Debit",
  "Credit Card",
  "E-Transfer",
  "Bank Transfer",
  "Cheque",
]);

export const PAYMENT_STATUSES = Object.freeze([
  "Pending",
  "Paid",
  "Refunded",
  "Partially Paid",
  "Overdue",
  "Cancelled",
]);

// Accept submissions from the previously deployed form during a rolling deploy,
// but always send the exact existing Airtable single-select value.
const LEGACY_PAYMENT_TYPE_ALIASES = Object.freeze({
  "Event Deposit": "Booking Deposit",
  "Final Event Payment": "Final Payment",
  "Booking Event": "Booking Deposit",
});

export function normalizePaymentType(value) {
  const cleaned = String(value || "").trim();
  return LEGACY_PAYMENT_TYPE_ALIASES[cleaned] || cleaned;
}

export function validatePaymentDraft(draft) {
  const errors = {};
  if (!draft.event) errors.event = "Select an Event.";
  else if (!/^rec[A-Za-z0-9]{14}$/.test(draft.event)) errors.event = "Select a valid Event.";
  if (!normalizePaymentType(draft.type)) errors.type = "Select a Payment Type.";
  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Enter an amount greater than zero.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(draft.date || ""))) errors.date = "Select a Payment Date.";
  if (normalizePaymentType(draft.type) === "Other" && !String(draft.other || "").trim()) errors.other = "Describe the Other payment type.";
  if (draft.budget && !/^rec[A-Za-z0-9]{14}$/.test(draft.budget)) errors.budget = "Select a valid Proposal / Budget.";
  return errors;
}

export function buildPaymentFields(draft, context = {}) {
  const type = normalizePaymentType(draft.type);
  const amount = Number(draft.amount);
  const fields = {
    Event: [draft.event],
    "Payment Type": type,
    "Payment Amount": type === "Refund" ? -Math.abs(amount) : amount,
    "Payment Date": draft.date,
    "Payment Method": draft.method,
    "Payment Status": draft.status,
    Currency: "CAD",
  };
  if (context.clientId) fields.Client = [context.clientId];
  if (draft.budget) fields["Proposal / Budget"] = [draft.budget];
  if (context.proposalNumber) fields["Proposal Number"] = context.proposalNumber;
  if (draft.reference) fields["Reference Number"] = draft.reference.trim();
  if (type === "Other") fields["Other Description"] = draft.other.trim();
  if (draft.due) fields["Due Date"] = draft.due;
  if (draft.notes) fields.Notes = draft.notes.trim();
  if (context.recordedBy) fields["Recorded By"] = context.recordedBy;
  return fields;
}

export async function readPaymentResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { return await response.json(); }
    catch { return { error: "The server returned an unreadable response." }; }
  }
  const text = (await response.text()).trim();
  return { error: text && text.length <= 240 ? text : "Unable to record payment." };
}

