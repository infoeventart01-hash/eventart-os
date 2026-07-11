import { NextRequest, NextResponse } from "next/server";

function cleanEnv(value: string | undefined) {
  return value?.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
}

// The application runs API routes inside a secure server environment. Values from
// .env files are available through import.meta.env there, not process.env.
const BASE_ID = cleanEnv(import.meta.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID) || "appcRlgcd7lcTzpFS";
const TOKEN = cleanEnv(import.meta.env.AIRTABLE_TOKEN || process.env.AIRTABLE_TOKEN);
const allowed = new Set(["Clients", "Events", "Inventory", "Rental Orders", "Payments", "Timeline", "Guests", "Vendors", "Seating Tables", "Design Board", "Budgets", "Budget Items"]);
const writable: Record<string, Set<string>> = {
  Clients: new Set(["Client Name", "Email", "Phone number", "Client Type", "Status", "Notes"]),
  Events: new Set(["Event Name", "Clients", "Event Type", "Event Status", "Ceremony Date & Time", "Venue Name", "Venue Address", "Guest Count", "Theme", "Color Palette", "Budget", "Total Contract", "Lead Planner", "Deposit Paid"]),
  Payments: new Set(["Event", "Client", "Payment Type", "Payment Amount", "Payment Date", "Due Date", "Payment Method", "Invoice Number", "Payment Status", "Notes"]),
  "Rental Orders": new Set(["Event", "Client", "Rental Item", "Rental Start Date", "Rental End Date", "Quantity", "Rental Price", "Delivery Fee", "Pickup Fee", "Setup Fee", "Security Deposit", "Discount", "Order Status", "Notes", "Return Condition"]),
  Guests: new Set(["Event", "First Name", "Last Name", "Email", "Phone", "RSVP Status", "RSVP Date", "Invitation Sent", "Assigned Table", "Seat Number", "Meal Choice", "Dietary Restrictions", "Family/Group", "VIP", "Children", "Gift Received", "Thank You Sent", "Notes", "Seating Chart"]),
  Timeline: new Set(["Timeline Item", "Event", "Date", "Start Time", "End Time", "Category", "Responsible Person", "Vendor", "Location", "Status", "Priority", "Notes"]),
  Vendors: new Set(["Vendor Name", "Category", "Contact Person", "Email", "Phone", "Website", "Event", "Contract Status", "Arrival Time", "Service Start Time", "Service End Time", "Total Fee", "Amount Paid", "Insurance Received", "Contract", "Notes"]),
  "Seating Tables": new Set(["Table Name", "Event", "Table Number", "Table Type", "Capacity", "Assigned Guests", "Table Location", "VIP Table", "Notes"]),
  "Design Board": new Set(["Design Title", "Event", "Design Category", "Design File", "Preview Image", "Design Link", "Version", "Approval Status", "Date Submitted", "Approval Date", "Client Comments", "Internal Notes", "Visible to Client"]),
  Budgets: new Set(["Budget Name", "Event", "Status", "Proposal Number", "Proposal Date", "Expiration Date", "Introduction", "Scope of Services", "Event Discount", "Contingency Type", "Contingency Value", "Deposit Required", "Payment Schedule", "Terms and Conditions", "Proposal Notes"]),
  "Budget Items": new Set(["Item / Service", "Budget", "Event", "Category", "Custom Category", "Description", "Quantity", "Unit Cost", "Unit Price", "Discount", "Taxable", "Tax Rate", "Vendor", "Notes", "Optional Item", "Included in Proposal", "Display Order"]),
};
const numericFields = new Set(["Event Discount", "Contingency Value", "Deposit Required", "Quantity", "Unit Cost", "Unit Price", "Discount", "Tax Rate", "Display Order", "Guest Count", "Budget", "Total Contract", "Deposit Paid", "Payment Amount", "Rental Price", "Delivery Fee", "Pickup Fee", "Setup Fee", "Security Deposit", "Seat Number", "Children", "Total Fee", "Amount Paid", "Table Number", "Capacity", "Version"]);
const recentRequests = new Map<string, number>();

function headers() { return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }; }
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
      if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a positive number`);
      output[name] = number;
    } else output[name] = value;
  }
  return output;
}

export async function GET(request: NextRequest) {
  const table = request.nextUrl.searchParams.get("table");
  const error = check(table);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const requestedSize = Number(request.nextUrl.searchParams.get("pageSize") || 100);
  const size = Number.isFinite(requestedSize) ? Math.max(1, Math.min(requestedSize, 100)) : 100;
  const url = new URL(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table!)}`);
  url.searchParams.set("pageSize", String(size));
  try {
    const response = await fetch(url, { headers: headers(), cache: "no-store" });
    const data: unknown = await response.json();
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status), { status: response.status });
    return NextResponse.json(data);
  } catch {
    const safe = { type: "NETWORK_ERROR", message: "Unable to connect to Airtable" };
    console.error("Airtable API error", safe);
    return NextResponse.json({ error: safe }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  const { table, id, fields } = await request.json();
  const error = check(table);
  if (error || !id || !fields) return NextResponse.json({ error: error || "Record and fields are required" }, { status: 400 });
  const url = `https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`;
  try {
  let validated: Record<string, unknown> | null;
  try { validated = safeFields(table, fields); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid values" }, { status: 400 }); }
  if (!validated || !Object.keys(validated).length) return NextResponse.json({ error: "No approved fields were supplied" }, { status: 400 });
  const response = await fetch(url, { method: "PATCH", headers: headers(), body: JSON.stringify({ fields: validated, typecast: false }) });
    const data: unknown = await response.json();
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status), { status: response.status });
    return NextResponse.json(data);
  } catch {
    const safe = { type: "NETWORK_ERROR", message: "Unable to connect to Airtable" };
    console.error("Airtable API error", safe);
    return NextResponse.json({ error: safe }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const { table, fields, requestId } = await request.json();
  const error = check(table);
  if (error) return NextResponse.json({ error }, { status: 400 });
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
  try {
    const response = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}`, { method: "POST", headers: headers(), body: JSON.stringify({ fields: validated, typecast: false }) });
    const data: unknown = await response.json();
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status), { status: response.status });
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: { type: "NETWORK_ERROR", message: "Unable to connect to Airtable" } }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const { table, id } = await request.json();
  const error = check(table);
  if (error || !id) return NextResponse.json({ error: error || "Record is required" }, { status: 400 });
  if (!writable[table]) return NextResponse.json({ error: "Record deletion is not enabled for this table" }, { status: 403 });
  try {
    const response = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
    const data: unknown = await response.json();
    if (!response.ok) return NextResponse.json(safeAirtableError(data, response.status), { status: response.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: { type: "NETWORK_ERROR", message: "Unable to connect to Airtable" } }, { status: 502 });
  }
}
