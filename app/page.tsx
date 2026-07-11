"use client";

import { useEffect, useMemo, useState } from "react";
import EventWorkspace from "./EventWorkspace";
import RecordForm, { formConfigs } from "./RecordForm";

type RecordRow = { id: string; createdTime?: string; fields: Record<string, unknown> };

const sections = [
  ["Dashboard", "Overview", "dashboard"], ["Events", "Events", "events"], ["Budgets & Proposals", "Budgets", "budgets"],
  ["Clients", "Clients", "clients"], ["Inventory", "Inventory", "inventory"],
  ["Rental Orders", "Rental Orders", "orders"], ["Payments", "Payments", "payments"],
  ["Tasks", "Timeline", "tasks"], ["Guests", "Guests", "guests"],
  ["Reports", "Payments", "reports"], ["Calendar", "Events", "calendar"],
  ["Kanban Board", "Events", "kanban"], ["Vendors", "Vendors", "vendors"],
  ["Seating Chart", "Seating Tables", "seating"], ["Design Board", "Design Board", "design"],
] as const;

const displayFields: Record<string, string[]> = {
  Events: ["Event Name", "Clients", "Event Type", "Event Status", "Ceremony Date & Time", "Venue Name", "Guest Count", "Budget", "Balance Due"],
  Clients: ["Client Name", "Email", "Phone number", "Client Type", "Status", "Events 2"],
  Inventory: ["Item Name", "Category", "Quantity Available", "Rental Price", "Condition", "Cleaning Status", "Available for Rental"],
  "Rental Orders": ["Order ID", "Event", "Client", "Rental Item", "Rental Start Date", "Rental End Date", "Quantity", "Total Rental", "Order Status"],
  Payments: ["Payment ID", "Client", "Payment Type", "Payment Amount", "Payment Date", "Due Date", "Payment Method", "Payment Status"],
  Timeline: ["Timeline Item", "Event", "Date", "Start Time", "Category", "Responsible Person", "Status", "Priority"],
  Guests: ["Full Name", "Event", "Email", "Phone", "RSVP Status", "Assigned Table", "Meal Choice", "VIP"],
  Vendors: ["Vendor Name", "Category", "Contact Person", "Email", "Phone", "Event", "Contract Status", "Balance Due"],
  "Seating Tables": ["Table Name", "Event", "Table Number", "Table Type", "Capacity", "Assigned Guest Count", "Remaining Seats", "VIP Table"],
  "Design Board": ["Design Title", "Event", "Design Category", "Version", "Approval Status", "Date Submitted", "Visible to Client"],
};

const statusField: Record<string, string> = { Events: "Event Status", Clients: "Status", Inventory: "Condition", "Rental Orders": "Order Status", Payments: "Payment Status", Timeline: "Status", Guests: "RSVP Status", Vendors: "Contract Status", "Design Board": "Approval Status" };

function shown(value: unknown) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function money(value: unknown) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

export default function EventArt() {
  const [active, setActive] = useState("Dashboard");
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [notice, setNotice] = useState("");
  const [budgetEvent, setBudgetEvent] = useState<RecordRow | null>(null);
  const [createTable, setCreateTable] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState("Overview");

  const config = sections.find(([label]) => label === active) || sections[0];
  const table = config[1];
  const mode = config[2];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(""); setRecords([]);
      const tables = mode === "dashboard" ? ["Events", "Payments", "Timeline"] : mode === "budgets" ? ["Budgets", "Events"] : [table];
      try {
        const result = await Promise.all(tables.map(async (name) => {
          const res = await fetch(`/api/airtable?table=${encodeURIComponent(name)}&pageSize=100`);
          if (!res.ok) throw new Error((await res.json()).error || "Unable to reach Airtable");
          const data = await res.json();
          return (data.records || []).map((record: RecordRow) => ({ ...record, _table: name }));
        }));
        if (!cancelled) setRecords(result.flat());
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load Airtable"); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [table, mode, refreshKey]);

  const filtered = useMemo(() => records.filter((r) => JSON.stringify(r.fields).toLowerCase().includes(query.toLowerCase())), [records, query]);
  const events = records.filter((r) => (r as RecordRow & { _table?: string })._table === "Events" || table === "Events");
  const payments = records.filter((r) => (r as RecordRow & { _table?: string })._table === "Payments" || table === "Payments");
  const timeline = records.filter((r) => (r as RecordRow & { _table?: string })._table === "Timeline" || table === "Timeline");

  async function save(fields: Record<string, unknown>) {
    if (!editing) return;
    setNotice("Saving to Airtable…");
    const res = await fetch("/api/airtable", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table, id: editing.id, fields }) });
    if (!res.ok) { setNotice("Could not save. Please check the field value."); return; }
    const updated = await res.json();
    setRecords((old) => old.map((r) => r.id === editing.id ? updated : r));
    setEditing(null); setNotice("Saved directly to Airtable.");
    setTimeout(() => setNotice(""), 3000);
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand"><img src="/eventart-logo.jpeg" alt="EventArt" /><div><strong>EventArt</strong><span>Luxury Event Design & Styling</span></div></div>
        <nav>{sections.map(([label]) => <button key={label} className={active === label ? "active" : ""} onClick={() => { setActive(label); setMobileNav(false); }}><span className="nav-dot" />{label}</button>)}</nav>
        <div className="side-footer"><span className="online-dot" /> Airtable connected<small>Version 1.0</small></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="header-brand"><img src="/eventart-logo.jpeg" alt="" /><strong>EventArt</strong></div>
          <button className="menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Open menu">☰</button>
          <div className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your workspace…" /></div>
          <div className="top-actions"><button className="icon-button" aria-label="Notifications">◌<i /></button><div className="avatar">MP</div><div className="profile"><strong>Maritza Paultre</strong><span>Lead Planner</span></div></div>
        </header>

        <div className={budgetEvent ? "content budget-content" : "content"}>
          {budgetEvent ? <EventWorkspace event={budgetEvent} initialTab={workspaceTab} onBack={() => setBudgetEvent(null)} /> : <>
          <div className="page-head"><div><p className="eyebrow">EVENTART / {active.toUpperCase()}</p><h1>{active === "Dashboard" ? "Welcome back, Maritza" : active}</h1><p>{active === "Dashboard" ? "Today you're creating unforgettable celebrations." : `Live ${active.toLowerCase()} information from your Airtable base.`}</p></div>{formConfigs[table] && <button className="gold-button" onClick={() => setCreateTable(table)}>＋ Add {active.replace(/s$/, "")}</button>}</div>
          {notice && <div className="notice">{notice}</div>}
          {loading ? <Loading /> : error ? <Empty error={error} /> : mode === "dashboard" ? <Dashboard events={events} payments={payments} timeline={timeline} /> : mode === "reports" ? <Reports payments={payments} /> : mode === "calendar" ? <Calendar records={events} /> : mode === "kanban" ? <Kanban records={events} /> : mode === "budgets" ? <BudgetsPage records={records} query={query} open={(event,tab) => { setWorkspaceTab(tab); setBudgetEvent(event); }} /> : <RecordTable table={table} records={filtered} onEdit={setEditing} onBudget={(event) => { setWorkspaceTab("Overview"); setBudgetEvent(event); }} />}
          </>}
        </div>
      </section>
      {editing && <EditPanel table={table} record={editing} onClose={() => setEditing(null)} onSave={save} />}
      {createTable && <RecordForm table={createTable} onClose={() => setCreateTable(null)} onSaved={() => { setCreateTable(null); setNotice("Record created successfully."); setRefreshKey(k => k + 1); }} />}
      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Close menu" />}
    </main>
  );
}

function Loading() { return <div className="loading-grid">{[1,2,3,4].map((n) => <div className="skeleton" key={n} />)}</div>; }
function Empty({ error }: { error: string }) { return <div className="empty"><img src="/eventart-logo.jpeg" alt="EventArt" /><h2>We couldn't load this page.</h2><p>{error}</p><span>Please refresh and try again.</span></div>; }

function Dashboard({ events, payments, timeline }: { events: RecordRow[]; payments: RecordRow[]; timeline: RecordRow[] }) {
  const booked = events.filter((e) => ["Contract Signed", "Deposit Paid", "Planning", "Design Approved"].includes(String(e.fields["Event Status"]))).length;
  const revenue = payments.filter((p) => p.fields["Payment Status"] === "Paid").reduce((a, p) => a + Number(p.fields["Payment Amount"] || 0), 0);
  const outstanding = events.reduce((a, e) => a + Number(e.fields["Balance Due"] || 0), 0);
  const upcoming = [...events].filter((e) => e.fields["Ceremony Date & Time"]).sort((a,b) => String(a.fields["Ceremony Date & Time"]).localeCompare(String(b.fields["Ceremony Date & Time"]))).slice(0,4);
  return <>
    <div className="metrics"><Metric label="Active events" value={String(booked || events.length)} note="Currently in your pipeline" /><Metric label="Revenue received" value={money(revenue)} note="Paid transactions" /><Metric label="Outstanding" value={money(outstanding)} note="Across all events" /><Metric label="Open tasks" value={String(timeline.filter((t) => t.fields.Status !== "Completed").length)} note="Timeline items remaining" /></div>
    <div className="dashboard-grid"><section className="card span2"><CardHead title="Upcoming events" /><div className="event-list">{upcoming.length ? upcoming.map((e) => <div className="event-row" key={e.id}><div className="date-tile"><b>{new Date(String(e.fields["Ceremony Date & Time"])).toLocaleDateString("en-CA", { day: "2-digit" })}</b><span>{new Date(String(e.fields["Ceremony Date & Time"])).toLocaleDateString("en-CA", { month: "short" }).toUpperCase()}</span></div><div className="event-main"><strong>{shown(e.fields["Event Name"])}</strong><span>{shown(e.fields["Venue Name"])}</span></div><span className="pill">{shown(e.fields["Event Status"])}</span><span className="chev">›</span></div>) : <p className="muted">No upcoming events found.</p>}</div></section>
    <section className="card"><CardHead title="Today’s focus" /><div className="focus-list">{timeline.slice(0,5).map((t) => <label key={t.id}><span className={t.fields.Status === "Completed" ? "check checked" : "check"}>✓</span><span><strong>{shown(t.fields["Timeline Item"])}</strong><small>{shown(t.fields.Category)} · {shown(t.fields.Priority)} priority</small></span></label>)}{!timeline.length && <p className="muted">No timeline items yet.</p>}</div></section></div>
  </>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function CardHead({ title, link }: { title: string; link?: string }) { return <div className="card-head"><div><span className="gold-line" /><h2>{title}</h2></div>{link && <button>{link} →</button>}</div>; }

function BudgetsPage({ records, query, open }: { records: RecordRow[]; query: string; open: (event: RecordRow, tab: string) => void }) {
  const [status, setStatus] = useState("All");
  const tagged = records as Array<RecordRow & { _table?: string }>;
  const budgets = tagged.filter(r => r._table === "Budgets");
  const events = tagged.filter(r => r._table === "Events");
  const statuses = ["All", "Draft", "In Review", "Sent", "Approved", "Declined", "Expired"];
  const rows = budgets.map(budget => {
    const ids = Array.isArray(budget.fields.Event) ? budget.fields.Event : [];
    const event = events.find(e => ids.includes(e.id));
    return { budget, event };
  }).filter(({ budget, event }) => {
    const matchesStatus = status === "All" || budget.fields.Status === status;
    const haystack = `${JSON.stringify(budget.fields)} ${event ? JSON.stringify(event.fields) : ""}`.toLowerCase();
    return matchesStatus && haystack.includes(query.toLowerCase());
  });
  return <section className="table-card budgets-list"><div className="table-tools"><span><b>{rows.length}</b> budgets and proposals</span><label className="status-filter">Status<select value={status} onChange={e => setStatus(e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select></label></div><div className="table-wrap"><table><thead><tr>{["Budget Name","Event","Status","Proposal Number","Proposal Date","Total Client Price","Deposit Required","Remaining Balance","Actions"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(({ budget, event }) => <tr key={budget.id}><td><b>{shown(budget.fields["Budget Name"])}</b></td><td>{event ? shown(event.fields["Event Name"]) : "Linked event unavailable"}</td><td><span className="pill">{shown(budget.fields.Status)}</span></td><td>{shown(budget.fields["Proposal Number"])}</td><td>{shown(budget.fields["Proposal Date"])}</td><td>{money(budget.fields["Total Client Price"])}</td><td>{money(budget.fields["Deposit Required"])}</td><td>{money(budget.fields["Remaining Balance"])}</td><td className="budget-list-actions"><button disabled={!event} onClick={() => event && open(event,"Budget & Proposal")}>Open Budget</button><button disabled={!event} onClick={() => event && open(event,"Overview")}>Open related Event</button></td></tr>)}</tbody></table>{!rows.length && <div className="workspace-empty"><h3>No matching budgets</h3><p>Try another search or status filter.</p></div>}</div></section>;
}

function RecordTable({ table, records, onEdit, onBudget }: { table: string; records: RecordRow[]; onEdit: (r: RecordRow) => void; onBudget: (r: RecordRow) => void }) {
  const fields = displayFields[table] || [];
  return <section className="table-card"><div className="table-tools"><span><b>{records.length}</b> records synced from Airtable</span></div><div className="table-wrap"><table><thead><tr>{fields.map((f) => <th key={f}>{f}</th>)}<th /></tr></thead><tbody>{records.map((r) => <tr key={r.id}>{fields.map((f) => <td key={f}>{f === statusField[table] ? <span className="pill">{shown(r.fields[f])}</span> : shown(r.fields[f])}</td>)}<td className="row-actions">{table === "Events" && <button className="budget-link" onClick={() => onBudget(r)}>Open Workspace</button>}<button className="edit" onClick={() => onEdit(r)}>Edit</button></td></tr>)}</tbody></table>{!records.length && <div className="no-records">No matching records found in Airtable.</div>}</div></section>;
}

function Reports({ payments }: { payments: RecordRow[] }) {
  const paid = payments.filter((p) => p.fields["Payment Status"] === "Paid").reduce((a,p) => a + Number(p.fields["Payment Amount"] || 0), 0);
  const pending = payments.filter((p) => ["Pending", "Overdue", "Partially Paid"].includes(String(p.fields["Payment Status"]))).reduce((a,p) => a + Number(p.fields["Payment Amount"] || 0), 0);
  const methods = ["E-Transfer", "Credit Card", "Cash", "Bank Transfer"].map((m) => ({ name:m, value: payments.filter((p) => p.fields["Payment Method"] === m).reduce((a,p) => a + Number(p.fields["Payment Amount"] || 0), 0) }));
  const max = Math.max(1, ...methods.map((m) => m.value));
  return <div className="report-grid"><div className="report-brand"><img src="/eventart-logo.jpeg" alt="EventArt"/><div><strong>EventArt</strong><span>Luxury Event Design & Styling</span></div></div><div className="metrics report-metrics"><Metric label="Total collected" value={money(paid)} note="Paid transactions" /><Metric label="Pending payments" value={money(pending)} note="Requires follow-up" /></div><section className="card span2"><CardHead title="Revenue by payment method" /><div className="bars">{methods.map((m) => <div key={m.name}><span>{m.name}</span><i><b style={{ width: `${(m.value/max)*100}%` }} /></i><strong>{money(m.value)}</strong></div>)}</div></section></div>;
}

function Calendar({ records }: { records: RecordRow[] }) {
  const days = Array.from({length:35}, (_,i) => i - 2);
  return <section className="calendar card"><div className="calendar-head"><button>‹</button><h2>July 2026</h2><button>›</button></div><div className="weekdays">{["SUN","MON","TUE","WED","THU","FRI","SAT"].map((d) => <span key={d}>{d}</span>)}</div><div className="days">{days.map((d,i) => <div key={i} className={d < 1 || d > 31 ? "outside" : ""}><b>{d < 1 ? 30+d : d > 31 ? d-31 : d}</b>{records.filter((r) => new Date(String(r.fields["Ceremony Date & Time"])).getDate() === d).slice(0,2).map((r) => <span key={r.id}>{shown(r.fields["Event Name"])}</span>)}</div>)}</div></section>;
}

function Kanban({ records }: { records: RecordRow[] }) {
  const columns = ["Inquiry", "Proposal Sent", "Contract Signed", "Planning", "Event Completed"];
  return <div className="kanban">{columns.map((status) => <section key={status}><header><span>{status}</span><b>{records.filter((r) => r.fields["Event Status"] === status).length}</b></header>{records.filter((r) => r.fields["Event Status"] === status).map((r) => <article key={r.id}><small>{shown(r.fields["Event Type"])}</small><h3>{shown(r.fields["Event Name"])}</h3><p>{shown(r.fields["Venue Name"])}</p><div><span>{r.fields["Ceremony Date & Time"] ? new Date(String(r.fields["Ceremony Date & Time"])).toLocaleDateString("en-CA") : "No date"}</span><b>{shown(r.fields["Guest Count"])} guests</b></div></article>)}</section>)}</div>;
}

function EditPanel({ table, record, onClose, onSave }: { table: string; record: RecordRow; onClose: () => void; onSave: (f: Record<string, unknown>) => void }) {
  const editable = (displayFields[table] || []).filter((f) => typeof record.fields[f] !== "object" && !["Balance Due", "Full Name", "Rental Period", "Subtotal", "Tax", "Service Total", "Total Rental", "Remaining Seats", "Assigned Guest Count"].includes(f));
  const [form, setForm] = useState<Record<string, unknown>>(() => Object.fromEntries(editable.map((f) => [f, record.fields[f] ?? ""])));
  return <div className="drawer-wrap"><button className="drawer-scrim" onClick={onClose} aria-label="Close editor" /><aside className="drawer"><div className="drawer-head"><div><p className="eyebrow">EDIT AIRTABLE RECORD</p><h2>{shown(record.fields[editable[0]])}</h2></div><button onClick={onClose}>×</button></div><div className="form">{editable.map((f) => <label key={f}><span>{f}</span>{typeof record.fields[f] === "boolean" ? <input type="checkbox" checked={Boolean(form[f])} onChange={(e) => setForm({...form,[f]:e.target.checked})} /> : <input value={shown(form[f]) === "—" ? "" : shown(form[f])} onChange={(e) => setForm({...form,[f]:e.target.value})} />}</label>)}</div><div className="drawer-actions"><button onClick={onClose}>Cancel</button><button className="gold-button" onClick={() => onSave(form)}>Save to Airtable</button></div></aside></div>;
}
