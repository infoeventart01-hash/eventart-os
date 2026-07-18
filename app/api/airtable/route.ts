import { NextRequest, NextResponse } from "next/server";
import { calculateFinancialSummary, type FinancialRecord } from "./financials";
import { requireIdentity, type EventArtIdentity } from "../../../lib/auth";

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
  Payments: new Set(["Event", "Client", "Payment Type", "Payment Amount", "Payment Date", "Due Date", "Payment Method", "Invoice Number", "Payment Status", "Notes"]),
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
const recentRequests = new Map<string, number>();
const linkDefinitions: Record<string, Record<string, { table: string; primary: string }>> = {
  Clients: { "Events 2": { table: "Events", primary: "Event Name" } },
  Events: { Clients: { table: "Clients", primary: "Client Name" } },
  "Rental Orders": { Event: { table: "Events", primary: "Event Name" }, Client: { table: "Clients", primary: "Client Name" }, "Rental Item": { table: "Inventory", primary: "Item Name" } },
  Payments: { Event: { table: "Events", primary: "Event Name" }, Client: { table: "Clients", primary: "Client Name" } },
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

async function allRecords(table: string, pageSize = 100) {
  const records: NonNullable<AirtablePage["records"]> = [];
  let offset = "";
  do {
    const url = new URL(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", String(pageSize));
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, { headers: headers(), cache: "no-store" });
    const data = await payload(response) as AirtablePage;
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

function safeAirtableError(data: unknown, status: number) {
  const payload = data as { error?: { type?: unknown; message?: unknown } | string };
  const nested = typeof payload?.error === "object" ? payload.error : undefined;
  const type = typeof nested?.type === "string" ? nested.type : `HTTP_${status}`;
  const message = typeof nested?.message === "string"
    ? nested.message
    : typeof payload?.error === "string" ? payload.error : "Airtable request failed";
  console.error("Airtable API error", { type, message });
  return { error: { type, message } };
}

function safeFields(table: string, input: unknown) {
  if (!writable[table] || !input || typeof input !== "object" || Array.isArray(input)) return null;
  const output: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (!writable[table].has(name)) continue;
    // "Budget" is a currency field on Events but a linked-record field on Budget Items.
    if (numericFields.has(name) && !(table === "Budget Items" && name === "Budget")) {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be zero or a positive number`);
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
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status), { status: response.status });
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
      await Promise.all(targetTables.map(async targetTable => {
        const { response: targetResponse, data: targetData } = await allRecords(targetTable, 100);
        if (!targetResponse.ok) throw new Error(`Unable to resolve ${targetTable}`);
        const primary = Object.values(definitions).find(definition => definition.table === targetTable)!.primary;
        targetRecords.set(targetTable, new Map((targetData.records || []).map(record => [record.id, String(record.fields[primary] || "").replaceAll("_", " ").replace(/\s+/g, " ").trim()])))
      }));
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
  } catch {
    const safe = { type: "NETWORK_ERROR", message: "Unable to connect to Airtable" };
    console.error("Airtable API error", safe);
    return NextResponse.json({ error: safe }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth=requireIdentity(request,["owner","team"]);if(auth.error)return auth.error;const identity=auth.identity!;
  const { table, id, fields, allowOverbook } = await request.json();
  const error = check(table);
  if (error || !id || !fields) return NextResponse.json({ error: error || "Record and fields are required" }, { status: 400 });
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
    if (seen && now - seen < 30000) return NextResponse.json({ error: "Duplicate submission prevented" }, { status: 409 });
    recentRequests.set(requestId, now);
  }
  let validated: Record<string, unknown> | null;
  try { validated = safeFields(table, fields); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid values" }, { status: 400 }); }
  if (!validated || !Object.keys(validated).length) return NextResponse.json({ error: "No approved fields were supplied" }, { status: 400 });
  if (table === "Guests") { const seatingError = await guestSeatingError(validated, undefined, Boolean(allowOverbook)); if (seatingError) return NextResponse.json({ error: seatingError }, { status: 409 }); }
  try {
    const response = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}`, { method: "POST", headers: headers(), body: JSON.stringify({ fields: validated, typecast: false }) });
    const data: unknown = await payload(response);
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status), { status: response.status });
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: { type: "NETWORK_ERROR", message: "Unable to connect to Airtable" } }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth=requireIdentity(request,["owner","team"]);if(auth.error)return auth.error;const identity=auth.identity!;
  const { table, id } = await request.json();
  const error = check(table);
  if (error || !id) return NextResponse.json({ error: error || "Record is required" }, { status: 400 });
  if (!writable[table]) return NextResponse.json({ error: "Record deletion is not enabled for this table" }, { status: 403 });
  if(identity.role==="team"){if(!teamWritable.has(table))return NextResponse.json({error:"This action is restricted to the EventArt owner."},{status:403});const current=await existingRecord(table,id);if(!current||!teamRecordAllowed(identity,table,current))return NextResponse.json({error:"This record is not assigned to your account."},{status:403})}
  try {
    const response = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
    const data: unknown = await payload(response);
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status), { status: response.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: { type: "NETWORK_ERROR", message: "Unable to connect to Airtable" } }, { status: 502 });
  }
}
