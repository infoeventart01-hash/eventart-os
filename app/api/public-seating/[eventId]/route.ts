import { NextRequest, NextResponse } from "next/server";

type AirtableRecord = { id: string; fields: Record<string, unknown> };
type AirtablePage = { records?: AirtableRecord[]; offset?: string };

const BASE_ID = (process.env.AIRTABLE_BASE_ID || "").trim();
const TOKEN = (process.env.AIRTABLE_TOKEN || "").trim();
const requests = new Map<string, { count: number; resetAt: number }>();

function airtableHeaders() {
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}

function linked(value: unknown, id: string) {
  return Array.isArray(value) && value.some(item => String(item) === id);
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];
}

function clean(value: unknown) {
  return String(value ?? "").replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

function clientKey(request: NextRequest) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "local").trim();
}

function rateLimited(request: NextRequest) {
  const key = clientKey(request);
  const now = Date.now();
  const current = requests.get(key);
  if (!current || current.resetAt <= now) {
    requests.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 60;
}

async function allRecords(table: "Guests" | "Seating Tables") {
  const records: AirtableRecord[] = [];
  let offset = "";
  do {
    const url = new URL(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, { headers: airtableHeaders(), cache: "no-store" });
    const data = await response.json() as AirtablePage;
    if (!response.ok) throw new Error(`Unable to load ${table}`);
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);
  return records;
}

export async function GET(request: NextRequest, context: { params: Promise<{ eventId: string }> }) {
  if (rateLimited(request)) return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  const { eventId } = await context.params;
  if (!TOKEN || !/^app[A-Za-z0-9]{14}$/.test(BASE_ID)) return NextResponse.json({ error: "Seating information is temporarily unavailable." }, { status: 503 });
  if (!/^rec[A-Za-z0-9]{14}$/.test(eventId)) return NextResponse.json({ error: "This event could not be found." }, { status: 404 });

  try {
    const eventResponse = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/Events/${encodeURIComponent(eventId)}`, { headers: airtableHeaders(), cache: "no-store" });
    if (eventResponse.status === 404) return NextResponse.json({ error: "This event could not be found." }, { status: 404 });
    const event = await eventResponse.json() as AirtableRecord;
    if (!eventResponse.ok) throw new Error("Unable to load event");

    const [allGuests, allTables] = await Promise.all([allRecords("Guests"), allRecords("Seating Tables")]);
    const guestRecords = allGuests.filter(record => linked(record.fields.Event, eventId));
    const tableRecords = allTables.filter(record => linked(record.fields.Event, eventId));
    const tableById = new Map(tableRecords.map(record => [record.id, record]));
    const tableByName = new Map<string, AirtableRecord>();
    tableRecords.forEach(record => {
      const number = clean(record.fields["Table Number"]);
      [record.fields["Table Name"], number, number ? `Table ${number}` : ""].map(clean).filter(Boolean).forEach(name => tableByName.set(name.toLocaleLowerCase(), record));
    });

    const guestTable = new Map<string, AirtableRecord>();
    for (const table of tableRecords) {
      for (const guestId of strings(table.fields["Assigned Guests"])) guestTable.set(guestId, table);
    }
    for (const guest of guestRecords) {
      const linkedTableId = [...strings(guest.fields["Seating Chart"]), ...strings(guest.fields["Assigned Table"])].find(id => tableById.has(id));
      const namedTable = strings(guest.fields["Assigned Table"]).map(name => tableByName.get(clean(name).toLocaleLowerCase())).find(Boolean);
      const assigned = linkedTableId ? tableById.get(linkedTableId) : namedTable;
      if (assigned) guestTable.set(guest.id, assigned);
    }

    const guestName = (guest: AirtableRecord) => clean(`${clean(guest.fields["First Name"])} ${clean(guest.fields["Last Name"])}`) || clean(guest.fields["Full Name"]);
    const publicTable = (table: AirtableRecord | undefined) => table ? {
      name: clean(table.fields["Table Name"]),
      number: clean(table.fields["Table Number"]),
      type: clean(table.fields["Table Type"]),
      location: clean(table.fields["Table Location"]),
      vip: Boolean(table.fields["VIP Table"]),
    } : null;

    const guests = guestRecords.map(guest => ({
      name: guestName(guest),
      table: publicTable(guestTable.get(guest.id)),
      seatNumber: clean(guest.fields["Seat Number"]),
      vip: Boolean(guest.fields.VIP),
    })).filter(guest => guest.name);

    const tables = tableRecords.map(table => ({
      ...publicTable(table)!,
      guests: guestRecords.filter(guest => guestTable.get(guest.id)?.id === table.id).map(guestName).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    }));

    return NextResponse.json({
      event: {
        name: clean(event.fields["Event Name"]),
        date: clean(event.fields["Ceremony Date & Time"] || event.fields["Event Date"]),
        venue: clean(event.fields["Venue Name"]),
      },
      guests,
      tables,
    }, { headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "Seating information is temporarily unavailable." }, { status: 502 });
  }
}
