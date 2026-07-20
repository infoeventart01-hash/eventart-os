import { NextRequest, NextResponse } from "next/server";
import { calculateFinancialSummary, type FinancialRecord } from "./financials";
import { requireIdentity, type EventArtIdentity } from "../../../lib/auth";
import { PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_TYPES, normalizePaymentType } from "../../../lib/payment-contract.mjs";
import { normalizeDateOnly } from "../../../lib/date-only.mjs";

function cleanEnv(value: string | undefined) {
  return value?.trim().replace(/^(['"])(.*)\1$/, "$2").trim() || "";
}

// Vinext loads local dotenv files into process.env and Cloudflare exposes
// encrypted Worker secrets there when nodejs_compat is enabled. Avoid
// import.meta.env so secret values are never substituted into build output.
const BASE_ID = cleanEnv(process.env.AIRTABLE_BASE_ID);
const TOKEN = cleanEnv(process.env.AIRTABLE_TOKEN);
const allowed = new Set(["Clients", "Events", "Inventory", "Rental Orders", "Payments", "Timeline", "Guests", "Vendors", "Seating Tables", "Design Board", "Budgets", "Budget Items", "Service Catalog"]);
const writable: Record<string, Set<string>> = {
  Clients: new Set(["Client Name", "Email", "Phone number", "Client Type", "Status", "Notes"]),
  Events: new Set(["Event Name", "Clients", "Event Type", "Event Status", "Ceremony Date & Time", "Venue Name", "Venue Address", "Guest Count", "Theme", "Color Palette", "Budget", "Total Contract", "Lead Planner", "Deposit Paid", "Seating QR Code", "Seating Canva Link"]),
  Inventory: new Set(["Item Name", "Category", "Subcategory", "Photo", "Quantity Owned", "Quantity Available", "Rental Price", "Replacement Cost", "Security Deposit", "Warehouse", "Shelf/Bin", "Condition", "Cleaning Status", "Notes", "Style Tags", "Available for Rental"]),
  Payments: new Set(["Payment Number", "Event", "Client", "Proposal / Budget", "Proposal Number", "Invoice Number", "Reference Number", "Payment Type", "Other Description", "Payment Amount", "Payment Date", "Due Date", "Payment Method", "Payment Status", "Currency", "Notes", "Recorded By", "Receipt Number", "Receipt PDF", "Invoice PDF", "Created At", "Updated At"]),
  "Rental Orders": new Set(["Event", "Client", "Rental Item", "Rental Start Date", "Rental End Date", "Quantity", "Rental Price", "Delivery Fee", "Pickup Fee", "Setup Fee", "Security Deposit", "Discount", "Order Status", "Notes", "Return Condition"]),
  Guests: new Set(["Event", "First Name", "Last Name", "Email", "Phone", "RSVP Status", "RSVP Date", "Invitation Sent", "Assigned Table", "Seat Number", "Meal Choice", "Dietary Restrictions", "Family/Group", "VIP", "Children", "Gift Received", "Thank You Sent", "Notes", "Seating Chart"]),
  Timeline: new Set(["Timeline Item", "Event", "Date", "Start Time", "End Time", "Category", "Responsible Person", "Vendor", "Location", "Status", "Priority", "Notes"]),
  Vendors: new Set(["Vendor Name", "Category", "Contact Person", "Email", "Phone", "Website", "Event", "Contract Status", "Arrival Time", "Service Start Time", "Service End Time", "Total Fee", "Amount Paid", "Insurance Received", "Contract", "Notes"]),
  "Seating Tables": new Set(["Table Name", "Event", "Table Number", "Table Type", "Capacity", "Assigned Guests", "Table Location", "VIP Table", "Notes"]),
  "Design Board": new Set(["Design Title", "Event", "Design Category", "Design File", "Preview Image", "Design Link", "Version", "Approval Status", "Date Submitted", "Approval Date", "Client Comments", "Internal Notes", "Visible to Client"]),
  Budgets: new Set(["Budget Name", "Event", "Status", "Proposal Number", "Proposal Date", "Expiration Date", "Introduction", "Scope of Services", "Event Discount", "Contingency Type", "Contingency Value", "Deposit Required", "Payment Schedule", "Terms and Conditions", "Proposal Notes"]),
  "Budget Items": new Set(["Item / Service", "Budget", "Event", "Category", "Custom Category", "Description", "Quantity", "Unit Cost", "Unit Price", "Discount", "Taxable", "Tax Rate", "Vendor", "Notes", "Optional Item", "Included in Proposal", "Display Order"]),
  "Service Catalog": new Set(["Service Name", "Category", "Description", "Standard Unit Cost", "Standard Unit Price", "Taxable", "Tax Rate", "Optional by Default", "Active", "Event Types", "Image", "Internal Notes", "Display Order"]),
};
const numericFields = new Set(["Event Discount", "Contingency Value", "Deposit Required", "Quantity", "Unit Cost", "Unit Price", "Discount", "Tax Rate", "Display Order", "Guest Count", "Budget", "Total Contract", "Deposit Paid", "Payment Amount", "Rental Price", "Delivery Fee", "Pickup Fee", "Setup Fee", "Security Deposit", "Seat Number", "Children", "Total Fee", "Amount Paid", "Table Number", "Capacity", "Version", "Quantity Owned", "Quantity Available", "Replacement Cost"]);
const dateOnlyFields: Record<string, Set<string>> = {
  "Rental Orders": new Set(["Rental Start Date", "Rental End Date"]),
  Payments: new Set(["Payment Date", "Due Date"]),
  Timeline: new Set(["Date"]),
  Guests: new Set(["RSVP Date"]),
  "Design Board": new Set(["Date Submitted", "Approval Date"]),
  Budgets: new Set(["Proposal Date", "Expiration Date"]),
};
const recentRequests = new Map<string, number>();
const pendingRequests = new Set<string>();
const linkDefinitions: Record<string, Record<string, { table: string; primary: string }>> = {
  Clients: { "Events 2": { table: "Events", primary: "Event Name" } },
  Events: { Clients: { table: "Clients", primary: "Client Name" } },
  "Rental Orders": { Event: { table: "Events", primary: "Event Name" }, Client: { table: "Clients", primary: "Client Name" }, "Rental Item": { table: "Inventory", primary: "Item Name" } },
  Payments: { Event: { table: "Events", primary: "Event Name" }, Client: { table: "Clients", primary: "Client Name" }, "Proposal / Budget": { table: "Budgets", primary: "Budget Name" } },
  Timeline: { Event: { table: "Events", primary: "Event Name" } },
  Guests: { Event: { table: "Events", primary: "Event Name" }, "Seating Chart": { table: "Seating Tables", primary: "Table Name" } },
  Vendors: { Event: { table: "Events", primary: "Event Name" } },
  "Seating Tables": { Event: { table: "Events", primary: "Event Name" }, "Assigned Guests": { table: "Guests", primary: "Full Name" } },
  "Design Board": { Event: { table: "Events", primary: "Event Name" } },
  Budgets: { Event: { table: "Events", primary: "Event Name" } },
  "Budget Items": { Budget: { table: "Budgets", primary: "Budget Name" }, Event: { table: "Events", primary: "Event Name" }, Vendor: { table: "Vendors", primary: "Vendor Name" } },
};
const teamReadable = new Set(["Events", "Timeline", "Guests", "Vendors", "Seating Tables", "Design Board"]);
const teamWritable = new Set(["Timeline", "Guests", "Vendors", "Seating Tables", "Design Board"]);
function eventLinks(table:string,id:string,fields:Record<string,unknown>){if(table==="Events")return [id];return Array.isArray(fields.Event)?fields.Event.map(String):[]}
function teamRecordAllowed(identity:EventArtIdentity,table:string,record:{id:string;fields:Record<string,unknown>}){return eventLinks(table,record.id,record.fields).some(id=>identity.eventRecordIds.includes(id))}
async function existingRecord(table:string,id:string){const response=await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`,{headers:headers(),cache:"no-store"});if(!response.ok)return null;return response.json() as Promise<{id:string;fields:Record<string,unknown>}>}

function headers() { return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }; }
type AirtablePage = { records?: Array<{ id: string; fields: Record<string, unknown>; createdTime?: string }>; offset?: string };

async function payload(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) return response.json().catch(() => ({}));
  const message = (await response.text().catch(() => "")).trim();
  return { error: { type: `HTTP_${response.status}`, message: message && message.length < 240 ? message : "Airtable request failed" } };
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function airtablePage(url: URL, table: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: headers(), cache: "no-store" });
      const data = await payload(response) as AirtablePage & { error?: { type?: string; message?: string } };
      if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 3) return { response, data };
      const delay = Math.max(250, Number(response.headers.get("retry-after") || 0) * 1000 || attempt * 350);
      console.error("EventArt Airtable request retry", { table, status: response.status, attempt, type: data.error?.type, message: data.error?.message });
      await wait(delay);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect to Airtable";
      console.error("EventArt Airtable network retry", { table, attempt, message });
      if (attempt === 3) throw error;
      await wait(attempt * 350);
    }
  }
  throw new Error(`Unable to load ${table}`);
}

async function allRecords(table: string, pageSize = 100) {
  const records: NonNullable<AirtablePage["records"]> = [];
  let offset = "";
  do {
    const url = new URL(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", String(pageSize));
    if (offset) url.searchParams.set("offset", offset);
    const { response, data } = await airtablePage(url, table);
    if (!response.ok) return { response, data };
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);
  return { response: new Response(null, { status: 200 }), data: { records } };
}
function check(table: string | null) {
  if (!TOKEN) return "Airtable token is not configured";
  if (!/^app[A-Za-z0-9]{14}$/.test(BASE_ID)) return "Airtable Base ID must start with 'app' and contain 17 characters";
  if (!table || !allowed.has(table)) return "This table is not part of the approved schema";
  return null;
}

function safeAirtableError(data: unknown, status: number, table?: string) {
  const payload = data as { error?: { type?: unknown; message?: unknown } | string };
  const nested = typeof payload?.error === "object" ? payload.error : undefined;
  const type = typeof nested?.type === "string" ? nested.type : `HTTP_${status}`;
  const message = typeof nested?.message === "string"
    ? nested.message
    : typeof payload?.error === "string" ? payload.error : "Airtable request failed";
  console.error("EventArt Airtable API error", { table: table || "unknown", status, type, message });
  const publicMessage = table === "Payments" && /due date/i.test(message)
    ? "Due Date must be a valid date."
    : message;
  return { error: { type, message: publicMessage } };
}

function safeFields(table: string, input: unknown) {
  if (!writable[table] || !input || typeof input !== "object" || Array.isArray(input)) return null;
  const output: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (!writable[table].has(name)) continue;
    if (value === undefined) continue;
    if (dateOnlyFields[table]?.has(name)) {
      if (value === null) output[name] = null;
      else {
        const normalized = normalizeDateOnly(value, name);
        if (normalized) output[name] = normalized;
      }
      continue;
    }
    // "Budget" is a currency field on Events but a linked-record field on Budget Items.
    if (numericFields.has(name) && !(table === "Budget Items" && name === "Budget")) {
      const number = typeof value === "number" ? value : Number(value);
      const refund = table === "Payments" && name === "Payment Amount" && (input as Record<string, unknown>)["Payment Type"] === "Refund";
      if (!Number.isFinite(number) || (!refund && number < 0)) throw new Error(`${name} must be zero or a positive number`);
      output[name] = number;
    } else output[name] = value;
  }
  return output;
}

async function guestSeatingError(fields: Record<string, unknown>, recordId: string | undefined, allowOverbook: boolean) {
  const requestedTable = Array.isArray(fields["Seating Chart"]) ? String(fields["Seating Chart"][0] || "") : "";
  if (!requestedTable) return null;
  if (!/^rec[A-Za-z0-9]{14}$/.test(requestedTable)) return "The assigned table is not valid.";
  let eventId = Array.isArray(fields.Event) ? String(fields.Event[0] || "") : "";
  if (!eventId && recordId) {
    const guestResponse = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/Guests/${encodeURIComponent(recordId)}`, { headers: headers(), cache: "no-store" });
    const guest = await guestResponse.json() as { fields?: Record<string, unknown> };
    eventId = Array.isArray(guest.fields?.Event) ? String(guest.fields?.Event[0] || "") : "";
  }
  if (!eventId) return "Select the guest's event before assigning a table.";
  const tableResponse = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent("Seating Tables")}/${encodeURIComponent(requestedTable)}`, { headers: headers(), cache: "no-store" });
  const seatingTable = await tableResponse.json() as { fields?: Record<string, unknown> };
  if (!tableResponse.ok) return "The selected seating table could not be loaded.";
  const tableEvents = Array.isArray(seatingTable.fields?.Event) ? seatingTable.fields?.Event as string[] : [];
  if (!tableEvents.includes(eventId)) return "The assigned table must belong to the guest's event.";
  const assigned = Array.isArray(seatingTable.fields?.["Assigned Guests"]) ? seatingTable.fields?.["Assigned Guests"] as string[] : [];
  const capacity = Number(seatingTable.fields?.Capacity || 0);
  if (capacity > 0 && assigned.length >= capacity && !assigned.includes(recordId || "") && !allowOverbook) return `${String(seatingTable.fields?.["Table Name"] || "This table")} is full. Confirm overbooking to continue.`;
  return null;
}

const deleteDependencies: Record<string, Array<{ table: string; field: string }>> = {
  Events: [
    { table: "Budgets", field: "Event" }, { table: "Budget Items", field: "Event" },
    { table: "Payments", field: "Event" }, { table: "Rental Orders", field: "Event" },
    { table: "Timeline", field: "Event" }, { table: "Guests", field: "Event" },
    { table: "Vendors", field: "Event" }, { table: "Seating Tables", field: "Event" },
    { table: "Design Board", field: "Event" },
  ],
  Clients: [
    { table: "Events", field: "Clients" }, { table: "Payments", field: "Client" },
    { table: "Rental Orders", field: "Client" },
  ],
  Budgets: [
    { table: "Budget Items", field: "Budget" }, { table: "Payments", field: "Proposal / Budget" },
  ],
  Inventory: [{ table: "Rental Orders", field: "Rental Item" }],
  Vendors: [{ table: "Budget Items", field: "Vendor" }],
  "Seating Tables": [{ table: "Guests", field: "Seating Chart" }],
};

async function dependencyError(table: string, recordId: string) {
  const definitions = deleteDependencies[table] || [];
  const impacts: string[] = [];
  for (const definition of definitions) {
    const result = await allRecords(definition.table, 100);
    if (!result.response.ok) return `Unable to verify linked ${definition.table} records. Nothing was deleted.`;
    const count = (result.data.records || []).filter(record => Array.isArray(record.fields[definition.field]) && (record.fields[definition.field] as string[]).includes(recordId)).length;
    if (count) impacts.push(`${count} ${definition.table} record${count === 1 ? "" : "s"}`);
  }
  return impacts.length ? `Delete blocked because this record is linked to ${impacts.join(", ")}. Reassign or remove those linked records first.` : "";
}

export async function GET(request: NextRequest) {
  const auth=requireIdentity(request,["owner","team"]);if(auth.error)return auth.error;const identity=auth.identity!;
  const table = request.nextUrl.searchParams.get("table");
  const error = check(table);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if(identity.role==="team"&&!teamReadable.has(table!))return NextResponse.json({error:"This area is restricted to the EventArt owner."},{status:403});
  const requestedSize = Number(request.nextUrl.searchParams.get("pageSize") || 100);
  const size = Number.isFinite(requestedSize) ? Math.max(1, Math.min(requestedSize, 100)) : 100;
  try {
    const { response, data } = await allRecords(table!, size);
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status, table!), { status: response.status });
    if(identity.role==="team"){
      const scoped=data as {records?:Array<{id:string;fields:Record<string,unknown>}>};
      scoped.records=(scoped.records||[]).filter(record=>teamRecordAllowed(identity,table!,record)).map(record=>{
        if(table!=="Events")return record;
        const fields={...record.fields};["Budget","Total Contract","Deposit Paid","Balance Due","Amount Paid"].forEach(field=>delete fields[field]);return {...record,fields};
      });
    }
    if (request.nextUrl.searchParams.get("resolveLinks") === "1" && linkDefinitions[table!]) {
      const payload = data as { records?: Array<{ id: string; fields: Record<string, unknown>; createdTime?: string }> };
      const definitions = linkDefinitions[table!];
      const targetTables = [...new Set(Object.values(definitions).map(definition => definition.table))];
      const targetRecords = new Map<string, Map<string, string>>();
      for (const targetTable of targetTables) {
        const { response: targetResponse, data: targetData } = await allRecords(targetTable, 100);
        if (!targetResponse.ok) {
          const failure = safeAirtableError(targetData, targetResponse.status, `${table} -> ${targetTable}`);
          throw new Error(failure.error.message);
        }
        const primary = Object.values(definitions).find(definition => definition.table === targetTable)!.primary;
        targetRecords.set(targetTable, new Map((targetData.records || []).map(record => [record.id, String(record.fields[primary] || "").replaceAll("_", " ").replace(/\s+/g, " ").trim()])))
      }
      payload.records = (payload.records || []).map(record => {
        const displayFields: Record<string, string> = {};
        for (const [field, definition] of Object.entries(definitions)) {
          const ids = Array.isArray(record.fields[field]) ? record.fields[field] as string[] : [];
          if (ids.length) displayFields[field] = ids.map(id => targetRecords.get(definition.table)?.get(id) || (field === "Event" ? "Unknown event" : "Unknown linked record")).join(", ");
        }
        return { ...record, displayFields };
      });
    }
    if (identity.role === "owner" && table === "Events" && request.nextUrl.searchParams.get("financialSummary") === "1") {
      const payload = data as { records?: FinancialRecord[]; financialTotals?: { revenueReceived: number; outstanding: number } };
      const [budgetResult, paymentResult] = await Promise.all([
        allRecords("Budgets", 100),
        allRecords("Payments", 100),
      ]);
      const budgetResponse = budgetResult.response;
      const paymentResponse = paymentResult.response;
      const budgetData = budgetResult.data as { records?: FinancialRecord[] };
      const paymentData = paymentResult.data as { records?: FinancialRecord[] };
      if (!budgetResponse.ok || !paymentResponse.ok) return NextResponse.json({ error: { type: "FINANCIAL_SUMMARY_ERROR", message: "Unable to calculate the live event balance" } }, { status: 502 });
      const summary = calculateFinancialSummary(payload.records || [], budgetData.records || [], paymentData.records || []);
      payload.records = summary.records;
      payload.financialTotals = summary.financialTotals;
    }
    return NextResponse.json(data);
  } catch (error) {
    const safe = { type: "NETWORK_ERROR", message: error instanceof Error ? error.message : "Unable to connect to Airtable" };
    console.error("EventArt Airtable loader error", { table, ...safe });
    return NextResponse.json({ error: safe }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth=requireIdentity(request,["owner","team"]);if(auth.error)return auth.error;const identity=auth.identity!;
  const { table, id, fields, allowOverbook } = await request.json();
  const error = check(table);
  if (error || !/^rec[A-Za-z0-9]{14}$/.test(String(id || "")) || !fields) return NextResponse.json({ error: error || "A valid Airtable record ID and fields are required" }, { status: 400 });
  if(identity.role==="team"){
    const seatingEventUpdate=table==="Events"&&Object.keys(fields as Record<string,unknown>).every(field=>["Seating QR Code","Seating Canva Link"].includes(field));
    if(!teamWritable.has(table)&&!seatingEventUpdate)return NextResponse.json({error:"This action is restricted to the EventArt owner."},{status:403});
    const current=await existingRecord(table,id);if(!current||!teamRecordAllowed(identity,table,current))return NextResponse.json({error:"This record is not assigned to your account."},{status:403});
    const requested=eventLinks(table,id,fields);if(requested.length&&!requested.every(eventId=>identity.eventRecordIds.includes(eventId)))return NextResponse.json({error:"You cannot move a record to an unassigned event."},{status:403});
  }
  const url = `https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`;
  try {
  let validated: Record<string, unknown> | null;
  try { validated = safeFields(table, fields); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid values" }, { status: 400 }); }
  if (!validated || !Object.keys(validated).length) return NextResponse.json({ error: "No approved fields were supplied" }, { status: 400 });
  if (table === "Payments") {
    const current = await existingRecord("Payments", id);
    if (!current) return NextResponse.json({ error: "The Payment record no longer exists." }, { status: 404 });
    const merged = { ...current.fields, ...validated };
    const eventId = Array.isArray(merged.Event) ? String(merged.Event[0] || "") : "";
    if (!/^rec[A-Za-z0-9]{14}$/.test(eventId)) return NextResponse.json({ error: "Select an Event before saving the payment." }, { status: 400 });
    const paymentType = normalizePaymentType(merged["Payment Type"]);
    if (!new Set(PAYMENT_TYPES).has(paymentType)) return NextResponse.json({ error: "Select a valid payment type." }, { status: 400 });
    validated["Payment Type"] = paymentType;
    if (paymentType === "Other" && !String(merged["Other Description"] || "").trim()) return NextResponse.json({ error: "Describe the Other payment type." }, { status: 400 });
    const amount = Number(merged["Payment Amount"]);
    if (!Number.isFinite(amount) || Math.abs(amount) <= 0) return NextResponse.json({ error: "Enter a payment amount greater than zero." }, { status: 400 });
    validated["Payment Amount"] = paymentType === "Refund" ? -Math.abs(amount) : Math.abs(amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(merged["Payment Date"] || ""))) return NextResponse.json({ error: "Select a valid Payment Date." }, { status: 400 });
    if (merged["Payment Method"] && !new Set(PAYMENT_METHODS).has(String(merged["Payment Method"]))) return NextResponse.json({ error: "Select a valid Payment Method." }, { status: 400 });
    if (merged["Payment Status"] && !new Set(PAYMENT_STATUSES).has(String(merged["Payment Status"]))) return NextResponse.json({ error: "Select a valid Payment Status." }, { status: 400 });
    const eventRecord = await existingRecord("Events", eventId);
    if (!eventRecord) return NextResponse.json({ error: "The selected Event no longer exists." }, { status: 400 });
    const eventClients = Array.isArray(eventRecord.fields.Clients) ? eventRecord.fields.Clients.map(String) : [];
    if (!eventClients.length) return NextResponse.json({ error: "The selected Event does not have a linked Client." }, { status: 400 });
    validated.Event = [eventId];
    validated.Client = eventClients.slice(0, 1);
    const budgetId = Array.isArray(merged["Proposal / Budget"]) ? String((merged["Proposal / Budget"] as unknown[])[0] || "") : "";
    if (budgetId) {
      if (!/^rec[A-Za-z0-9]{14}$/.test(budgetId)) return NextResponse.json({ error: "Select a valid Proposal / Budget." }, { status: 400 });
      const budget = await existingRecord("Budgets", budgetId);
      const linkedEvents = Array.isArray(budget?.fields.Event) ? budget!.fields.Event as string[] : [];
      if (!budget || !linkedEvents.includes(eventId)) return NextResponse.json({ error: "The selected Proposal / Budget does not belong to this Event." }, { status: 400 });
      validated["Proposal / Budget"] = [budgetId];
      validated["Proposal Number"] = String(budget.fields["Proposal Number"] || merged["Proposal Number"] || "");
    }
    validated["Updated At"] = new Date().toISOString();
  }
  if (table === "Guests") { const seatingError = await guestSeatingError(validated, id, Boolean(allowOverbook)); if (seatingError) return NextResponse.json({ error: seatingError }, { status: 409 }); }
  const response = await fetch(url, { method: "PATCH", headers: headers(), body: JSON.stringify({ fields: validated, typecast: false }) });
    const data: unknown = await payload(response);
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status), { status: response.status });
    return NextResponse.json(data);
  } catch {
    const safe = { type: "NETWORK_ERROR", message: "Unable to connect to Airtable" };
    console.error("Airtable API error", safe);
    return NextResponse.json({ error: safe }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const auth=requireIdentity(request,["owner","team"]);if(auth.error)return auth.error;const identity=auth.identity!;
  const { table, fields, requestId, allowOverbook } = await request.json();
  const error = check(table);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if(identity.role==="team"&&(!teamWritable.has(table)||!eventLinks(table,"",fields||{}).some(eventId=>identity.eventRecordIds.includes(eventId))))return NextResponse.json({error:"You can create records only for events assigned to your account."},{status:403});
  if (!writable[table]) return NextResponse.json({ error: "Record creation is not enabled for this table" }, { status: 403 });
  if (typeof requestId === "string") {
    const now = Date.now();
    const seen = recentRequests.get(requestId);
    if (pendingRequests.has(requestId) || (seen && now - seen < 30000)) return NextResponse.json({ error: "Duplicate submission prevented" }, { status: 409 });
  }
  let validated: Record<string, unknown> | null;
  try { validated = safeFields(table, fields); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid values" }, { status: 400 }); }
  if (!validated || !Object.keys(validated).length) return NextResponse.json({ error: "No approved fields were supplied" }, { status: 400 });
  if (table === "Payments") {
    const eventId = Array.isArray(validated.Event) ? String(validated.Event[0] || "") : "";
    if (!/^rec[A-Za-z0-9]{14}$/.test(eventId)) return NextResponse.json({ error: "Select an Event before recording the payment." }, { status: 400 });
    const paymentType = normalizePaymentType(validated["Payment Type"]);
    const approvedTypes = new Set(PAYMENT_TYPES);
    if (!approvedTypes.has(paymentType)) return NextResponse.json({ error: "Select a valid payment type." }, { status: 400 });
    validated["Payment Type"] = paymentType;
    if (paymentType === "Other" && !String(validated["Other Description"] || "").trim()) return NextResponse.json({ error: "Describe the Other payment type." }, { status: 400 });
    const amount = Number(validated["Payment Amount"]);
    if (!Number.isFinite(amount) || Math.abs(amount) <= 0) return NextResponse.json({ error: "Enter a payment amount greater than zero." }, { status: 400 });
    validated["Payment Amount"] = paymentType === "Refund" ? -Math.abs(amount) : amount;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(validated["Payment Date"] || ""))) return NextResponse.json({ error: "Select a valid Payment Date." }, { status: 400 });
    if (validated["Payment Method"] && !new Set(PAYMENT_METHODS).has(String(validated["Payment Method"]))) return NextResponse.json({ error: "Select a valid Payment Method." }, { status: 400 });
    if (validated["Payment Status"] && !new Set(PAYMENT_STATUSES).has(String(validated["Payment Status"]))) return NextResponse.json({ error: "Select a valid Payment Status." }, { status: 400 });
    const event = await existingRecord("Events", eventId);
    if (!event) return NextResponse.json({ error: "The selected Event no longer exists." }, { status: 400 });
    const eventClients = Array.isArray(event.fields.Clients) ? event.fields.Clients.map(String) : [];
    if (!eventClients.length) return NextResponse.json({ error: "The selected Event does not have a linked Client." }, { status: 400 });
    validated.Client = eventClients.slice(0, 1);
    const budgetId = Array.isArray(validated["Proposal / Budget"]) ? String((validated["Proposal / Budget"] as unknown[])[0] || "") : "";
    if (budgetId) {
      if (!/^rec[A-Za-z0-9]{14}$/.test(budgetId)) return NextResponse.json({ error: "Select a valid Proposal / Budget." }, { status: 400 });
      const budget = await existingRecord("Budgets", budgetId);
      const linkedEvents = Array.isArray(budget?.fields.Event) ? budget!.fields.Event as string[] : [];
      if (!budget || !linkedEvents.includes(eventId)) return NextResponse.json({ error: "The selected Proposal / Budget does not belong to this Event." }, { status: 400 });
      validated["Proposal Number"] = String(budget.fields["Proposal Number"] || validated["Proposal Number"] || "");
    }
    const existing = await allRecords("Payments", 100);
    if (!existing.response.ok) return NextResponse.json(safeAirtableError(existing.data, existing.response.status, "Payments"), { status: existing.response.status });
    const rows = existing.data.records || [];
    const year = new Date().getFullYear();
    const next = (prefix: string) => {
      const pattern = new RegExp(`^${prefix}-${year}-(\\d{4,})$`);
      const field = prefix === "PAY" ? "Payment Number" : prefix === "INV" ? "Invoice Number" : "Receipt Number";
      const highest = rows.reduce((max, row) => Math.max(max, Number(String(row.fields[field] || "").match(pattern)?.[1] || 0)), 0);
      return `${prefix}-${year}-${String(highest + 1).padStart(4, "0")}`;
    };
    validated["Payment Number"] ||= next("PAY");
    validated["Invoice Number"] ||= next("INV");
    validated["Receipt Number"] ||= next("REC");
    validated.Currency ||= "CAD";
    validated["Recorded By"] ||= identity.name || identity.email;
    const now = new Date().toISOString();
    validated["Created At"] ||= now;
    validated["Updated At"] = now;
  }
  if (table === "Guests") { const seatingError = await guestSeatingError(validated, undefined, Boolean(allowOverbook)); if (seatingError) return NextResponse.json({ error: seatingError }, { status: 409 }); }
  if (typeof requestId === "string") pendingRequests.add(requestId);
  try {
    const response = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}`, { method: "POST", headers: headers(), body: JSON.stringify({ fields: validated, typecast: false }) });
    const data: unknown = await payload(response);
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status), { status: response.status });
    if (typeof requestId === "string") recentRequests.set(requestId, Date.now());
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: { type: "NETWORK_ERROR", message: "Unable to connect to Airtable" } }, { status: 502 });
  } finally {
    if (typeof requestId === "string") pendingRequests.delete(requestId);
  }
}

export async function DELETE(request: NextRequest) {
  const auth=requireIdentity(request,["owner","team"]);if(auth.error)return auth.error;const identity=auth.identity!;
  const { table, id } = await request.json();
  const error = check(table);
  if (error || !/^rec[A-Za-z0-9]{14}$/.test(String(id || ""))) return NextResponse.json({ error: error || "A valid Airtable record ID is required" }, { status: 400 });
  if (!writable[table]) return NextResponse.json({ error: "Record deletion is not enabled for this table" }, { status: 403 });
  if(identity.role==="team"){if(!teamWritable.has(table))return NextResponse.json({error:"This action is restricted to the EventArt owner."},{status:403});const current=await existingRecord(table,id);if(!current||!teamRecordAllowed(identity,table,current))return NextResponse.json({error:"This record is not assigned to your account."},{status:403})}
  try {
    const blocked = await dependencyError(table, id);
    if (blocked) return NextResponse.json({ error: { type: "LINKED_RECORDS", message: blocked } }, { status: 409 });
    const response = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
    const data: unknown = await payload(response);
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status), { status: response.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: { type: "NETWORK_ERROR", message: "Unable to connect to Airtable" } }, { status: 502 });
  }
}
