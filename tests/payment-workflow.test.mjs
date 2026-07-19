import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  PAYMENT_TYPES,
  buildPaymentFields,
  normalizePaymentType,
  readPaymentResponse,
  validatePaymentDraft,
} from "../lib/payment-contract.mjs";

const valid = {
  event: "recaP8tQAACIJOiCz",
  budget: "",
  type: "Booking Deposit",
  other: "",
  amount: "125.50",
  date: "2026-07-19",
  due: "",
  method: "E-Transfer",
  status: "Paid",
  reference: "",
  notes: "",
};

test("missing Event is rejected with an inline-safe message", () => {
  assert.equal(validatePaymentDraft({ ...valid, event: "" }).event, "Select an Event.");
});

test("missing or zero Amount is rejected", () => {
  assert.equal(validatePaymentDraft({ ...valid, amount: "" }).amount, "Enter an amount greater than zero.");
  assert.equal(validatePaymentDraft({ ...valid, amount: "0" }).amount, "Enter an amount greater than zero.");
});

test("event-level payment uses Airtable linked-record arrays and omits an empty Proposal", () => {
  const fields = buildPaymentFields(valid, { clientId: "recbP8tQAACIJOiCd", recordedBy: "Owner" });
  assert.deepEqual(fields.Event, [valid.event]);
  assert.deepEqual(fields.Client, ["recbP8tQAACIJOiCd"]);
  assert.equal(fields["Payment Amount"], 125.5);
  assert.equal("Proposal / Budget" in fields, false);
  assert.equal(Object.values(fields).includes(undefined), false);
});

test("proposal-linked payment uses the Proposal record ID and number", () => {
  const fields = buildPaymentFields({ ...valid, budget: "recBP8tQAACIJOiCz" }, { proposalNumber: "PROP-100" });
  assert.deepEqual(fields["Proposal / Budget"], ["recBP8tQAACIJOiCz"]);
  assert.equal(fields["Proposal Number"], "PROP-100");
});

test("invalid Airtable linked-record values are rejected", () => {
  assert.equal(validatePaymentDraft({ ...valid, event: "Wedding" }).event, "Select a valid Event.");
  assert.equal(validatePaymentDraft({ ...valid, budget: "Proposal 1" }).budget, "Select a valid Proposal / Budget.");
});

test("Airtable JSON and text errors become readable UI messages", async () => {
  const json = await readPaymentResponse(new Response(JSON.stringify({ error: { type: "INVALID_VALUE", message: "Invalid linked record" } }), { status: 422, headers: { "content-type": "application/json" } }));
  assert.equal(json.error.message, "Invalid linked record");
  const text = await readPaymentResponse(new Response("Payload rejected", { status: 400, headers: { "content-type": "text/plain" } }));
  assert.equal(text.error, "Payload rejected");
});

test("legacy production labels normalize to existing Airtable choices", () => {
  assert.equal(normalizePaymentType("Event Deposit"), "Booking Deposit");
  assert.equal(normalizePaymentType("Final Event Payment"), "Final Payment");
  assert.equal(normalizePaymentType("Booking Event"), "Booking Deposit");
  assert.ok(PAYMENT_TYPES.includes("Booking Deposit"));
});

test("duplicate submit prevention and a reachable modal footer are wired", async () => {
  const [component, route, styles] = await Promise.all([
    readFile(new URL("../app/PaymentsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/airtable/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/payment-modal.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /if \(busy \|\| Object\.keys\(errors\)\.length\) return/);
  assert.match(component, /type="submit" className="gold-button" disabled=\{!canSubmit\}/);
  assert.match(component, />Cancel</);
  assert.match(component, /editing \? "Save Changes" : "Record Payment"/);
  assert.match(route, /Duplicate submission prevented/);
  assert.match(styles, /overflow-y: auto/);
  assert.match(styles, /position: sticky/);
});
