import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import QRCode from "qrcode";
import { calculateFinancialSummary } from "../app/api/airtable/financials.ts";

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("financial summaries prefer the approved budget and never produce a negative balance", () => {
  const events = [
    { id: "recEvent000000001", fields: { "Event Status": "Planning", "Total Contract": 9000 } },
    { id: "recEvent000000002", fields: { "Event Status": "Event Completed", "Total Contract": 500 } },
  ];
  const budgets = [
    { id: "recBudget00000001", createdTime: "2026-01-01", fields: { Event: [events[0].id], Status: "Draft", "Total Client Price": 12000 } },
    { id: "recBudget00000002", createdTime: "2026-02-01", fields: { Event: [events[0].id], Status: "Approved", "Total Client Price": 19824 } },
  ];
  const payments = [
    { id: "recPayment0000001", fields: { Event: [events[0].id], "Payment Status": "Paid", "Payment Amount": 500 } },
    { id: "recPayment0000002", fields: { Event: [events[0].id], "Payment Status": "Pending", "Payment Amount": 3000 } },
    { id: "recPayment0000003", fields: { Event: [events[0].id], "Payment Status": "Refunded", "Payment Amount": 200 } },
    { id: "recPayment0000004", fields: { Event: [events[0].id], "Payment Status": "Completed", "Payment Amount": 25000 } },
    { id: "recPayment0000005", fields: { Event: [events[1].id], "Payment Status": "Received", "Payment Amount": 100 } },
  ];
  const result = calculateFinancialSummary(events, budgets, payments);
  assert.equal(result.records[0].computedFields["Total Contract"], 19824);
  assert.equal(result.records[0].computedFields["Amount Paid"], 25500);
  assert.equal(result.records[0].computedFields["Balance Due"], 0);
  assert.equal(result.financialTotals.revenueReceived, 25600);
  assert.equal(result.financialTotals.outstanding, 0);
});

test("financial summaries use latest same-priority budget and event fallback", () => {
  const events = [{ id: "recEvent000000003", fields: { "Event Status": "Planning", "Total Contract": 7000 } }];
  const samePriority = [
    { id: "recBudget00000003", createdTime: "2026-01-01", fields: { Event: [events[0].id], Status: "Sent", "Total Client Price": 8000 } },
    { id: "recBudget00000004", createdTime: "2026-03-01", fields: { Event: [events[0].id], Status: "Sent", "Total Client Price": 9000 } },
  ];
  assert.equal(calculateFinancialSummary(events, samePriority, []).records[0].computedFields["Total Contract"], 9000);
  assert.equal(calculateFinancialSummary(events, [], []).records[0].computedFields["Total Contract"], 7000);
});

test("QR generator produces valid PNG data and SVG without Airtable", async () => {
  const url = "https://eventart.example/seating/recExample0000001";
  const [png, svg] = await Promise.all([QRCode.toDataURL(url), QRCode.toString(url, { type: "svg" })]);
  assert.match(png, /^data:image\/png;base64,/);
  assert.match(svg, /<svg[^>]+>/);
  assert.match(svg, /<path/);
});

test("all Event Workspace tabs and team restrictions are wired", async () => {
  const workspace = await source("../app/EventWorkspace.tsx");
  for (const tab of ["Overview", "Budget & Proposal", "Guests", "Rental Orders", "Payments", "Timeline / Tasks", "Vendors", "Seating", "Design Studio", "Files & Media", "Notes"]) assert.match(workspace, new RegExp(`\\"${tab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\"`));
  assert.match(workspace, /role==="team"\?\["Events","Guests","Timeline","Vendors","Seating Tables","Design Board"\]/);
  assert.match(workspace, /teamTabs/);
  assert.match(workspace, /SeatingAssignments/);
});

test("proposal preview, print and PDF use one component and protect internal values", async () => {
  const [budget, css] = await Promise.all([source("../app/BudgetWorkspace.tsx"), source("../app/globals.css")]);
  assert.match(budget, /setPreview\(true\)/);
  assert.match(budget, /window\.print\(\)/);
  assert.match(budget, /className="proposal-document"/);
  assert.match(budget, /title="Your Event Experience"/);
  assert.doesNotMatch(budget.slice(budget.indexOf("function ProposalPreview")), /Unit Cost|Estimated Profit|Profit Margin|Private proposal notes/);
  assert.match(budget, /if\(!includedPages\.length\)includedPages\.push\(\[\]\)/);
  assert.match(budget, /optional\.length>0/);
  assert.match(css, /print-color-adjust:exact/);
  assert.match(css, /break-inside:avoid/);
  assert.match(css, /table-header-group/);
  assert.match(css, /investment-card/);
});

test("CRUD, duplicate protection, confirmations and automatic refresh are present", async () => {
  const [api, form, page, workspace] = await Promise.all([source("../app/api/airtable/route.ts"), source("../app/RecordForm.tsx"), source("../app/page.tsx"), source("../app/EventWorkspace.tsx")]);
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) assert.match(api, new RegExp(`export async function ${method}`));
  assert.match(api, /Duplicate submission prevented/);
  assert.match(form, /if\(saving\)return/);
  assert.match(form, /disabled=\{saving/);
  assert.match(page, /window\.confirm/);
  assert.match(workspace, /await load\(\)/);
});

test("attachment workflows create records before upload and enforce file limits", async () => {
  const [form, upload] = await Promise.all([source("../app/RecordForm.tsx"), source("../app/api/airtable/upload/route.ts")]);
  assert.ok(form.indexOf("fetch('/api/airtable'") < form.indexOf('fetch("/api/airtable/upload"'));
  assert.match(form, /form\.set\("record",data\.id\)/);
  assert.match(upload, /const maxBytes=5\*1024\*1024/);
  assert.match(upload, /request\.formData\(\)/);
  assert.match(upload, /Inventory:new Set\(\["Photo"\]\)/);
  assert.match(upload, /"Design Board":new Set\(\["Design File","Preview Image"\]\)/);
});

test("security protects management writes and keeps public seating read-only", async () => {
  const [proxy, api, upload, seating] = await Promise.all([source("../proxy.ts"), source("../app/api/airtable/route.ts"), source("../app/api/airtable/upload/route.ts"), source("../app/api/public-seating/[eventId]/route.ts")]);
  assert.match(proxy, /auth\.getUser\(\)/);
  assert.match(api, /requireIdentity\(request,\["owner","team"\]\)/);
  assert.match(upload, /requireIdentity\(request,\["owner","team"\]\)/);
  assert.match(seating, /export async function GET/);
  assert.doesNotMatch(seating, /export async function (?:POST|PATCH|DELETE)/);
  assert.doesNotMatch(seating, /Email|Phone|Payment|Notes/);
});
