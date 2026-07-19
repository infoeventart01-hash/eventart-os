import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("all operational Airtable modules use the shared record-ID CRUD form", async () => {
  const form = await source("../app/RecordForm.tsx");
  for (const table of ["Clients", "Events", "Payments", "Budgets", "Budget Items", "Inventory", "Rental Orders", "Vendors", "Timeline", "Guests", "Seating Tables", "Design Board", "Service Catalog"]) {
    assert.match(form, new RegExp(table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(form, /const existingId=record\?\.id\|\|createdRecordId\.current/);
  assert.match(form, /method:existingId\?'PATCH':'POST'/);
  assert.match(form, /id:existingId\|\|undefined/);
  assert.match(form, /requestId:existingId\?undefined:requestId\.current/);
  assert.match(form, /record\?\.fields\[f\.name\]/);
  assert.match(form, /retained=.*\.id/);
});

test("generic lists expose view, edit, and confirmed delete actions", async () => {
  const [page, details, confirm] = await Promise.all([
    source("../app/page.tsx"), source("../app/RecordDetails.tsx"), source("../app/ConfirmDialog.tsx"),
  ]);
  assert.match(page, />View</);
  assert.match(page, />Edit</);
  assert.match(page, />Delete</);
  assert.match(page, /confirmation\.confirm/);
  assert.match(details, /record\.fields/);
  assert.match(confirm, /This action cannot be undone/);
  assert.match(confirm, />Cancel</);
  assert.match(confirm, /confirmLabel \|\| "Delete"/);
});

test("Payments supports create, same-ID update, delete, refresh, and balance feedback", async () => {
  const [payments, route] = await Promise.all([source("../app/PaymentsWorkspace.tsx"), source("../app/api/airtable/route.ts")]);
  assert.match(payments, /method: editing \? "PATCH" : "POST"/);
  assert.match(payments, /id: editing\?\.id/);
  assert.match(payments, /requestId: editing \? undefined/);
  assert.match(payments, /method: "DELETE"/);
  assert.match(payments, /onChanged\(\)/);
  assert.match(payments, /Changes saved successfully/);
  assert.match(payments, /Payment deleted successfully/);
  assert.match(payments, /Current balance/);
  assert.match(route, /The Payment record no longer exists/);
  assert.match(route, /validated\["Updated At"\]/);
});

test("Events and Clients are protected from unsafe linked-record deletion", async () => {
  const route = await source("../app/api/airtable/route.ts");
  assert.match(route, /const deleteDependencies/);
  assert.match(route, /Events: \[/);
  assert.match(route, /Clients: \[/);
  assert.match(route, /Delete blocked because this record is linked to/);
  assert.match(route, /status: 409/);
});

test("Budget update and intentional duplicate paths remain separate", async () => {
  const [page, budget] = await Promise.all([source("../app/page.tsx"), source("../app/BudgetWorkspace.tsx")]);
  assert.match(page, /async function duplicateBudget/);
  assert.match(page, /requestId:`budget-copy-/);
  assert.match(budget, /method:"PATCH"|api\("PATCH"/);
  assert.match(budget, /onDuplicate/);
});

test("long forms have scrollable bodies and sticky reachable actions on mobile", async () => {
  const [crudStyles, paymentStyles, form, payment] = await Promise.all([
    source("../app/crud-form.css"), source("../app/payment-modal.css"), source("../app/RecordForm.tsx"), source("../app/PaymentsWorkspace.tsx"),
  ]);
  for (const styles of [crudStyles, paymentStyles]) {
    assert.match(styles, /overflow-y: auto/);
    assert.match(styles, /position: sticky/);
    assert.match(styles, /max-height: 100dvh/);
  }
  assert.match(form, /disabled=\{saving\|\|missing\.length>0\}/);
  assert.match(form, /'Save Changes'/);
  assert.match(payment, /disabled=\{!canSubmit\}/);
  assert.match(payment, /"Save Changes"/);
});

test("API mutation routes retain Owner and Team authorization", async () => {
  const route = await source("../app/api/airtable/route.ts");
  for (const method of ["POST", "PATCH", "DELETE"]) assert.match(route, new RegExp(`export async function ${method}`));
  assert.match(route, /requireIdentity\(request,\["owner","team"\]\)/);
  assert.match(route, /teamWritable/);
  assert.match(route, /A valid Airtable record ID/);
});

