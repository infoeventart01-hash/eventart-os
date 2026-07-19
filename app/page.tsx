"use client";

import { useEffect, useMemo, useState } from "react";
import EventWorkspace from "./EventWorkspace";
import RecordForm, { formConfigs } from "./RecordForm";
import DesignStudio from "./DesignStudio";
import UserManagement from "./UserManagement";
import PaymentsWorkspace from "./PaymentsWorkspace";
import { useConfirmDialog } from "./ConfirmDialog";
import RecordDetails from "./RecordDetails";

type RecordRow = { id: string; createdTime?: string; fields: Record<string, unknown>; displayFields?: Record<string, string>; computedFields?: Record<string, number> };
type DashboardErrors = Record<string, string>;

function errorMessage(value: unknown, fallback = "An unexpected error occurred.") {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const payload = value as { message?: unknown; error?: unknown; type?: unknown };
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
    if (payload.error !== undefined) return errorMessage(payload.error, fallback);
    if (typeof payload.type === "string" && payload.type.trim()) return payload.type.replaceAll("_", " ").toLowerCase();
  }
  return fallback;
}

const sections = [
  ["Dashboard", "Overview", "dashboard"],
  ["Clients", "Clients", "clients"], ["Events", "Events", "events"], ["Budgets & Proposals", "Budgets", "budgets"],
  ["Tasks", "Timeline", "tasks"], ["Calendar", "Events", "calendar"], ["Kanban Board", "Events", "kanban"], ["Guests", "Guests", "guests"], ["Seating Chart", "Seating Tables", "seating"], ["Vendors", "Vendors", "vendors"],
  ["Inventory", "Inventory", "inventory"], ["Rental Orders", "Rental Orders", "orders"], ["Payments", "Payments", "payments"],
  ["Service Catalog", "Service Catalog", "catalog"],
  ["Design Studio", "Design Board", "design"],
  ["Reports", "Payments", "reports"],
  ["User Management", "Users", "users"],
] as const;

const navGroups = [
  { label: "Client Management", items: ["Clients", "Events", "Budgets & Proposals"] },
  { label: "Event Operations", items: ["Tasks", "Calendar", "Kanban Board", "Guests", "Seating Chart", "Vendors"] },
  { label: "Rentals & Finance", items: ["Inventory", "Rental Orders", "Payments", "Service Catalog"] },
  { label: "Creative", items: ["Design Studio"] },
  { label: "Analytics", items: ["Reports"] },
  { label: "Account", items: ["User Management"] },
] as const;

const routeByLabel: Record<string, string> = {
  Dashboard: "/", Clients: "/clients", Events: "/events", "Budgets & Proposals": "/budgets",
  Tasks: "/tasks", Calendar: "/calendar", "Kanban Board": "/kanban", Guests: "/guests",
  "Seating Chart": "/seating-chart", Vendors: "/vendors", Inventory: "/inventory",
  "Rental Orders": "/rental-orders", Payments: "/payments", "Service Catalog": "/service-catalog",
  "Design Studio": "/design-studio", Reports: "/reports", "User Management": "/user-management",
};
const labelByRoute = Object.fromEntries(Object.entries(routeByLabel).map(([label, route]) => [route, label]));

const displayFields: Record<string, string[]> = {
  Events: ["Event Name", "Clients", "Event Type", "Event Status", "Ceremony Date & Time", "Venue Name", "Guest Count", "Budget", "Total Contract", "Amount Paid", "Balance Due"],
  Clients: ["Client Name", "Email", "Phone number", "Client Type", "Status", "Events 2"],
  Inventory: ["Photo", "Item Name", "Category", "Subcategory", "Quantity Owned", "Quantity Available", "Rental Price", "Replacement Cost", "Condition", "Cleaning Status"],
  "Rental Orders": ["Order ID", "Event", "Client", "Rental Item", "Rental Start Date", "Rental End Date", "Quantity", "Total Rental", "Order Status"],
  Payments: ["Payment ID", "Client", "Payment Type", "Payment Amount", "Payment Date", "Due Date", "Payment Method", "Payment Status"],
  Timeline: ["Timeline Item", "Event", "Date", "Start Time", "Category", "Responsible Person", "Status", "Priority"],
  Guests: ["Full Name", "Event", "Email", "Phone", "RSVP Status", "Assigned Table", "Meal Choice", "VIP"],
  Vendors: ["Vendor Name", "Category", "Contact Person", "Email", "Phone", "Event", "Contract Status", "Balance Due"],
  "Seating Tables": ["Table Name", "Event", "Table Number", "Table Type", "Capacity", "Assigned Guest Count", "Remaining Seats", "VIP Table"],
  "Design Board": ["Design Title", "Event", "Design Category", "Version", "Approval Status", "Date Submitted", "Visible to Client"],
  "Service Catalog": ["Service Name", "Category", "Description", "Standard Unit Price", "Standard Unit Cost", "Taxable", "Optional by Default", "Active", "Event Types"],
};

const statusField: Record<string, string> = { Events: "Event Status", Clients: "Status", Inventory: "Condition", "Rental Orders": "Order Status", Payments: "Payment Status", Timeline: "Status", Guests: "RSVP Status", Vendors: "Contract Status", "Design Board": "Approval Status" };

function shown(value: unknown) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

function money(value: unknown) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.max(0, n));
}

function tableValue(record: RecordRow, field: string) {
  if (record.computedFields?.[field] !== undefined) return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(record.computedFields[field]);
  if (record.displayFields?.[field]) return record.displayFields[field];
  if (field === "Event Name") return shown(record.fields[field]).replaceAll("_", " ").replace(/\s+/g, " ").trim();
  if (["Ceremony Date & Time", "Start Time", "End Time"].includes(field) && record.fields[field]) {
    const date = new Date(String(record.fields[field]));
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(date);
  }
  if (["Budget", "Total Contract", "Amount Paid", "Balance Due", "Rental Price", "Replacement Cost"].includes(field)) return record.fields[field] == null || record.fields[field] === "" ? "—" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(record.fields[field]) || 0);
  return shown(record.fields[field]);
}

function InventoryThumbnail({value,name}:{value:unknown;name:unknown}) {
  const attachment=Array.isArray(value)?value[0] as {url?:string;thumbnails?:{small?:{url?:string}}}:undefined;
  const src=attachment?.thumbnails?.small?.url||attachment?.url;
  return src?<img className="inventory-thumbnail" src={src} alt={String(name||"Inventory item")}/>:<span className="inventory-thumbnail empty" aria-label="No photo">—</span>;
}

export default function EventArt() {
  const [identity,setIdentity]=useState<{name:string;email:string;role:"owner"|"team"|"client";developmentAuthBypass?:boolean}|null>(null);
  const [active, setActive] = useState("Dashboard");
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboardErrors, setDashboardErrors] = useState<DashboardErrors>({});
  const [query, setQuery] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [viewing, setViewing] = useState<RecordRow | null>(null);
  const [notice, setNotice] = useState("");
  const [budgetEvent, setBudgetEvent] = useState<RecordRow | null>(null);
  const [createTable, setCreateTable] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState("Overview");
  const [financialTotals, setFinancialTotals] = useState({ revenueReceived: 0, outstanding: 0 });
  const [pendingEventId, setPendingEventId] = useState("");
  const confirmation = useConfirmDialog();
  useEffect(()=>{fetch("/api/auth/me",{cache:"no-store"}).then(async response=>{const data=await response.json();if(response.ok)setIdentity(data)}).catch(()=>undefined)},[]);
  const firstName=identity?.name?.split(/\s+/)[0]||"there";
  const allowedTeam=new Set(["Events","Tasks","Guests","Seating Chart","Vendors","Design Studio"]);
  const visibleGroups=navGroups.map(group=>({...group,items:group.items.filter(label=>identity?.role!=="team"||allowedTeam.has(label))})).filter(group=>group.items.length);

  function navigate(label: string) {
    setActive(label); setMobileNav(false); setBudgetEvent(null);
    window.history.pushState({}, "", routeByLabel[label] || "/");
  }
  function openWorkspace(event: RecordRow, tab = "Overview") {
    setWorkspaceTab(tab); setBudgetEvent(event);
    window.history.pushState({}, "", `/events/${encodeURIComponent(event.id)}`);
  }

  useEffect(() => {
    const applyLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const eventId = params.get("event") || "";
      const requested = params.get("view") || labelByRoute[window.location.pathname];
      if (requested && sections.some(([label]) => label === requested)) setActive(requested);
      if (eventId) { setActive("Events"); setPendingEventId(eventId); }
      else if (!window.location.pathname.startsWith("/events/")) { setPendingEventId(""); setBudgetEvent(null); }
    };
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, []);

  useEffect(() => {
    if (!pendingEventId || budgetEvent) return;
    const selected = records.find(record => record.id === pendingEventId);
    if (selected) { setBudgetEvent(selected); setPendingEventId(""); }
  }, [records, pendingEventId, budgetEvent]);

  const config = sections.find(([label]) => label === active) || sections[0];
  const table = config[1];
  const mode = config[2];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if(mode==="users"){setLoading(false);setRecords([]);return}
      setLoading(true); setError(""); setDashboardErrors({}); setRecords([]);
      const tables = mode === "dashboard" ? ["Events", "Clients", "Payments", "Timeline"] : mode === "budgets" ? ["Budgets", "Events"] : [table];
      try {
        const loadTable = async (name: string) => {
          const res = await fetch(`/api/airtable?table=${encodeURIComponent(name)}&pageSize=100&resolveLinks=1${name === "Events" ? "&financialSummary=1" : ""}`);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(errorMessage(data, `Unable to load ${name} from Airtable.`));
          return { records: (data.records || []).map((record: RecordRow) => ({ ...record, _table: name })), financialTotals: name === "Events" ? data.financialTotals : undefined };
        };
        const result = [] as Array<{ records: Array<RecordRow & { _table: string }>; financialTotals?: { revenueReceived: number; outstanding: number } }>;
        const failures: DashboardErrors = {};
        for (const name of tables) {
          try { result.push(await loadTable(name)); }
          catch (failure) {
            const message = errorMessage(failure, `Unable to load ${name}.`);
            if (mode === "dashboard") failures[name] = message;
            else throw failure;
            if (process.env.NODE_ENV === "development") console.error("EventArt dashboard widget error", { table: name, message });
          }
        }
        if (!cancelled) {
          setRecords(result.flatMap(entry => entry.records));
          setDashboardErrors(failures);
          const totals = result.find(entry => entry.financialTotals)?.financialTotals;
          setFinancialTotals(totals || { revenueReceived: 0, outstanding: 0 });
        }
      } catch (e) { if (!cancelled) setError(errorMessage(e, "Unable to load this page.")); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [table, mode, refreshKey]);

  const filtered = useMemo(() => records.filter((r) => JSON.stringify(r.fields).toLowerCase().includes(query.toLowerCase())), [records, query]);
  const events = records.filter((r) => (r as RecordRow & { _table?: string })._table === "Events" || table === "Events");
  const clients = records.filter((r) => (r as RecordRow & { _table?: string })._table === "Clients" || table === "Clients");
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
  async function catalogUpdate(record:RecordRow,fields:Record<string,unknown>){const res=await fetch("/api/airtable",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({table:"Service Catalog",id:record.id,fields})});if(!res.ok){setNotice("Unable to update service.");return}setNotice("Service Catalog updated.");setRefreshKey(key=>key+1)}
  async function duplicateService(record:RecordRow){const fields:Record<string,unknown>={...record.fields,"Service Name":`${shown(record.fields["Service Name"])} Copy`};delete fields.Image;const res=await fetch("/api/airtable",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({table:"Service Catalog",requestId:`catalog-${Date.now()}`,fields})});if(!res.ok){setNotice("Unable to duplicate service.");return}setNotice("Service duplicated.");setRefreshKey(key=>key+1)}
  async function duplicateBudget(record:RecordRow){const allowed=["Budget Name","Event","Status","Proposal Number","Proposal Date","Expiration Date","Introduction","Scope of Services","Event Discount","Contingency Type","Contingency Value","Deposit Required","Payment Schedule","Terms and Conditions","Proposal Notes"];const fields=Object.fromEntries(allowed.filter(field=>record.fields[field]!==undefined).map(field=>[field,record.fields[field]]));fields["Budget Name"]=`${shown(record.fields["Budget Name"])} Copy`;fields.Status="Draft";fields["Proposal Number"]=`${shown(record.fields["Proposal Number"])}-COPY`;const res=await fetch("/api/airtable",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({table:"Budgets",requestId:`budget-copy-${Date.now()}`,fields})});const data=await res.json().catch(()=>({}));if(!res.ok){setNotice(errorMessage(data,"Unable to duplicate budget."));return}setNotice("Budget duplicated successfully.");setRefreshKey(key=>key+1)}

  async function remove(record: RecordRow, recordTable = table) {
    const name = shown(record.fields[displayFields[recordTable]?.[0] || "Budget Name"]);
    const accepted = await confirmation.confirm({
      title: `Delete ${recordTable.replace(/s$/, "")}?`,
      name,
      body: recordTable === "Events"
        ? "This action cannot be undone. EventArt will block deletion while linked budgets, payments, guests, vendors, timeline items, seating tables, rentals, or designs remain."
        : "This action cannot be undone. Linked-record dependencies will be checked before deletion.",
    });
    if (!accepted) return;
    setNotice("Deleting from Airtable…");
    try {
      const res = await fetch("/api/airtable", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table: recordTable, id: record.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorMessage(data, "Unable to delete this record"));
      setRecords(old => old.filter(r => r.id !== record.id)); setEditing(null); setNotice(`${recordTable.replace(/s$/, "")} deleted successfully.`); setRefreshKey(k => k + 1);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Unable to delete this record"); }
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand"><img src="/eventart-logo-transparent.png" alt="EventArt" /><div><strong>EventArt</strong><span>Luxury Event Design & Styling</span></div></div>
        <nav className="sidebar-nav">{identity?.role!=="team"&&<NavButton label="Dashboard" active={active} select={navigate}/>} {visibleGroups.map(group=><section className="nav-group" key={group.label}><h2>{group.label}</h2>{group.items.map(label=><NavButton key={label} label={label} active={active} select={navigate}/>)}</section>)}</nav>
        <div className="side-footer"><span className="online-dot" /> Airtable connected<small>Version 1.0</small></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="header-brand"><img src="/eventart-logo-transparent.png" alt="" /><strong>EventArt</strong></div>
          <button className="menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Open menu">☰</button>
          <div className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your workspace…" /></div>
          <div className="top-actions"><div className="avatar">{identity?.name?.split(/\s+/).map(part=>part[0]).join("").slice(0,2).toUpperCase()||"EA"}</div><details className="account-menu"><summary className="profile"><strong>{identity?.name||"EventArt User"}</strong><span>{identity?.role==="owner"?"Owner / Admin":identity?.role==="team"?"Team Member":"Client"}</span></summary><div><b>{identity?.email}</b><span>{identity?.role}</span><button onClick={()=>window.location.assign("/forgot-password")}>Change Password</button><button onClick={async()=>{await fetch("/api/auth/logout",{method:"POST"});window.location.assign("/login")}}>Log Out</button></div></details></div>
        </header>

        {identity?.developmentAuthBypass && <div className="dev-auth-banner" role="status">Development authentication bypass is active</div>}

        <div className={budgetEvent ? "content budget-content" : "content"}>
          {budgetEvent ? <EventWorkspace event={budgetEvent} initialTab={workspaceTab} role={identity?.role} onBack={() => navigate("Events")} /> : <>
          {mode!=="design"&&<div className="page-head"><div><p className="eyebrow">EVENTART / {active.toUpperCase()}</p><h1>{active === "Dashboard" ? `Welcome back, ${firstName}` : active}</h1><p>{active === "Dashboard" ? "Today you're creating unforgettable celebrations." : mode==="users"?"Invite users and control their EventArt access.":`Live ${active.toLowerCase()} information from your Airtable base.`}</p></div>{formConfigs[table] && mode!=="payments" && <button className="gold-button" onClick={() => setCreateTable(table)}>＋ Add {active.replace(/s$/, "")}</button>}</div>}
          {notice && <div className="notice">{notice}</div>}
          {mode === "users" ? <UserManagement/> : mode === "design" ? <DesignStudio onOpenEvent={(event)=>openWorkspace(event,"Design Studio")}/> : loading ? <Loading /> : error ? <Empty error={error} retry={()=>setRefreshKey(key=>key+1)} /> : mode === "dashboard" ? <Dashboard events={events} clients={clients} payments={payments} timeline={timeline} financialTotals={financialTotals} errors={dashboardErrors} retry={()=>setRefreshKey(key=>key+1)} /> : mode === "payments" ? <PaymentsWorkspace payments={payments} recordedBy={identity?.name||identity?.email||"EventArt"} onChanged={()=>setRefreshKey(key=>key+1)}/> : mode === "reports" ? <Reports payments={payments} /> : mode === "calendar" ? <Calendar records={events} /> : mode === "kanban" ? <Kanban records={events} /> : mode === "budgets" ? <BudgetsPage records={records} query={query} open={openWorkspace} onDuplicate={duplicateBudget} onDelete={budget => remove(budget,"Budgets")} /> : mode==="catalog"?<CatalogPage records={records} onEdit={setEditing} onDuplicate={duplicateService} onArchive={record=>catalogUpdate(record,{Active:false})} onDelete={record=>remove(record,"Service Catalog")}/>: <RecordTable table={table} records={filtered} onView={setViewing} onEdit={setEditing} onDelete={remove} onBudget={openWorkspace} />}
          </>}
        </div>
      </section>
      {editing && <RecordForm table={table} record={editing} onClose={() => setEditing(null)} onSaved={(updated) => { setRecords(old => old.map(r => r.id === updated.id ? updated : r)); setEditing(null); setNotice("Changes saved successfully."); setRefreshKey(k => k + 1); }} />}
      {viewing && <RecordDetails table={table} record={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />}
      {createTable && <RecordForm table={createTable} onClose={() => setCreateTable(null)} onSaved={() => { const createdLabel=createTable.replace(/s$/, ""); setCreateTable(null); setNotice(`${createdLabel} created successfully.`); setRefreshKey(k => k + 1); }} />}
      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Close menu" />}
      {confirmation.dialog}
    </main>
  );
}

function NavButton({label,active,select}:{label:string;active:string;select:(label:string)=>void}){return <button className={active===label?"active":""} onClick={()=>select(label)}><span className="nav-icon" aria-hidden="true"/>{label}</button>}
function Loading() { return <div className="loading-grid">{[1,2,3,4].map((n) => <div className="skeleton" key={n} />)}</div>; }
function Empty({ error, retry }: { error: string; retry: () => void }) { return <div className="empty" role="alert"><img src="/eventart-logo-transparent.png" alt="EventArt" /><h2>Unable to load this page.</h2><p><strong>Reason:</strong> {errorMessage(error)}</p><button className="gold-button" onClick={retry}>Try again</button></div>; }

function Dashboard({ events, clients, payments, timeline, financialTotals, errors, retry }: { events: RecordRow[]; clients: RecordRow[]; payments: RecordRow[]; timeline: RecordRow[]; financialTotals: { revenueReceived: number; outstanding: number }; errors: DashboardErrors; retry: () => void }) {
  const booked = events.filter((e) => ["Contract Signed", "Deposit Paid", "Planning", "Design Approved"].includes(String(e.fields["Event Status"]))).length;
  const upcoming = [...events].filter((e) => e.fields["Ceremony Date & Time"]).sort((a,b) => String(a.fields["Ceremony Date & Time"]).localeCompare(String(b.fields["Ceremony Date & Time"]))).slice(0,4);
  const recentClients = [...clients].sort((a,b)=>String(b.createdTime||"").localeCompare(String(a.createdTime||""))).slice(0,4);
  const recentPayments = [...payments].sort((a,b)=>String(b.fields["Payment Date"]||"").localeCompare(String(a.fields["Payment Date"]||""))).slice(0,4);
  const errorEntries = Object.entries(errors);
  return <>
    {errorEntries.length > 0 && <section className="dashboard-warning" role="alert"><h2>Some dashboard information is temporarily unavailable.</h2>{errorEntries.map(([table,message])=><p key={table}><strong>{table}:</strong> {message}</p>)}<button onClick={retry}>Retry unavailable widgets</button></section>}
    <div className="metrics"><Metric label="Upcoming Events" value={String(booked || events.length)} note="Currently in your pipeline" /><Metric label="Revenue" value={money(financialTotals.revenueReceived)} note="Paid transactions" /><Metric label="Outstanding Balances" value={money(financialTotals.outstanding)} note="Across active events" /><Metric label="Open tasks" value={String(timeline.filter((t) => t.fields.Status !== "Completed").length)} note="Timeline items remaining" /></div>
    <div className="dashboard-grid"><section className="card span2"><CardHead title="Upcoming events" /><div className="event-list">{upcoming.length ? upcoming.map((e) => <div className="event-row" key={e.id}><div className="date-tile"><b>{new Date(String(e.fields["Ceremony Date & Time"])).toLocaleDateString("en-CA", { day: "2-digit" })}</b><span>{new Date(String(e.fields["Ceremony Date & Time"])).toLocaleDateString("en-CA", { month: "short" }).toUpperCase()}</span></div><div className="event-main"><strong>{shown(e.fields["Event Name"])}</strong><span>{shown(e.fields["Venue Name"])}</span></div><span className="pill">{shown(e.fields["Event Status"])}</span><span className="chev">›</span></div>) : <p className="muted">No upcoming events found.</p>}</div></section>
    <section className="card"><CardHead title="Today’s focus" /><div className="focus-list">{timeline.slice(0,5).map((t) => <label key={t.id}><span className={t.fields.Status === "Completed" ? "check checked" : "check"}>✓</span><span><strong>{shown(t.fields["Timeline Item"])}</strong><small>{shown(t.fields.Category)} · {shown(t.fields.Priority)} priority</small></span></label>)}{!timeline.length && <p className="muted">No timeline items yet.</p>}</div></section></div>
    <div className="dashboard-secondary">
      <section className="card"><CardHead title="Recent Clients" /><div className="focus-list">{recentClients.map(client=><div className="dashboard-list-item" key={client.id}><strong>{shown(client.fields["Client Name"])}</strong><small>{shown(client.fields.Status)}</small></div>)}{!recentClients.length&&<p className="muted">No recent clients found.</p>}</div></section>
      <section className="card"><CardHead title="Payments" /><div className="focus-list">{recentPayments.map(payment=><div className="dashboard-list-item" key={payment.id}><strong>{money(payment.fields["Payment Amount"])}</strong><small>{shown(payment.fields["Payment Status"])}</small></div>)}{!recentPayments.length&&<p className="muted">No payments found.</p>}</div></section>
      <section className="card"><CardHead title="Quick Actions" /><div className="quick-actions"><button onClick={()=>window.location.assign("/events")}>View Events</button><button onClick={()=>window.location.assign("/clients")}>View Clients</button><button onClick={()=>window.location.assign("/payments")}>View Payments</button></div></section>
      <section className="card"><CardHead title="Calendar" /><p className="muted">{upcoming.length ? `${upcoming.length} upcoming events are scheduled.` : "No upcoming events scheduled."}</p></section>
      <section className="card"><CardHead title="Notifications" /><div className="focus-list">{timeline.slice(0,4).map(task=><div className="dashboard-list-item" key={task.id}><strong>{shown(task.fields["Timeline Item"])}</strong><small>{shown(task.fields.Priority)} priority</small></div>)}{!timeline.length&&<p className="muted">You&apos;re all caught up.</p>}</div></section>
    </div>
  </>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function CardHead({ title, link }: { title: string; link?: string }) { return <div className="card-head"><div><span className="gold-line" /><h2>{title}</h2></div>{link && <button>{link} →</button>}</div>; }

function BudgetsPage({ records, query, open, onDuplicate, onDelete }: { records: RecordRow[]; query: string; open: (event: RecordRow, tab: string) => void; onDuplicate: (budget: RecordRow) => void; onDelete: (budget: RecordRow) => void }) {
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
  return <section className="table-card budgets-list"><div className="table-tools"><span><b>{rows.length}</b> budgets and proposals</span><label className="status-filter">Status<select value={status} onChange={e => setStatus(e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select></label></div><div className="table-wrap"><table><thead><tr>{["Budget Name","Event","Status","Proposal Number","Proposal Date","Total Client Price","Deposit Required","Remaining Balance","Actions"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(({ budget, event }) => <tr key={budget.id}><td><b>{shown(budget.fields["Budget Name"])}</b></td><td>{event ? shown(event.fields["Event Name"]) : "Linked event unavailable"}</td><td><span className="pill">{shown(budget.fields.Status)}</span></td><td>{shown(budget.fields["Proposal Number"])}</td><td>{shown(budget.fields["Proposal Date"])}</td><td>{money(budget.fields["Total Client Price"])}</td><td>{money(budget.fields["Deposit Required"])}</td><td>{money(budget.fields["Remaining Balance"])}</td><td className="budget-list-actions"><button disabled={!event} onClick={() => event && open(event,"Budget & Proposal")}>Open Budget</button><button disabled={!event} onClick={() => event && open(event,"Overview")}>Open related Event</button><button onClick={() => onDuplicate(budget)}>Duplicate</button><button className="danger" onClick={() => onDelete(budget)}>Delete</button></td></tr>)}</tbody></table>{!rows.length && <div className="workspace-empty"><h3>No matching budgets</h3><p>Try another search or status filter.</p></div>}</div></section>;
}

function CatalogPage({records,onEdit,onDuplicate,onArchive,onDelete}:{records:RecordRow[];onEdit:(record:RecordRow)=>void;onDuplicate:(record:RecordRow)=>void;onArchive:(record:RecordRow)=>void;onDelete:(record:RecordRow)=>void}){const [search,setSearch]=useState("");const [category,setCategory]=useState("All");const [eventType,setEventType]=useState("All");const [active,setActive]=useState("All");const [sort,setSort]=useState("Display Order");const categories=["All",...new Set(records.map(record=>String(record.fields.Category||"")).filter(Boolean))];const eventTypes=["All",...new Set(records.flatMap(record=>Array.isArray(record.fields["Event Types"])?record.fields["Event Types"] as string[]:[]))];const rows=[...records].filter(record=>{const fields=record.fields;return JSON.stringify(fields).toLowerCase().includes(search.toLowerCase())&&(category==="All"||fields.Category===category)&&(eventType==="All"||(Array.isArray(fields["Event Types"])&&fields["Event Types"].includes(eventType)))&&(active==="All"||Boolean(fields.Active)===(active==="Active"))}).sort((a,b)=>sort==="Price"?Number(a.fields["Standard Unit Price"]||0)-Number(b.fields["Standard Unit Price"]||0):sort==="Display Order"?Number(a.fields["Display Order"]||0)-Number(b.fields["Display Order"]||0):String(a.fields[sort]||"").localeCompare(String(b.fields[sort]||"")));return <section className="catalog-page"><div className="catalog-tools"><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search services…"/><select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(value=><option key={value}>{value}</option>)}</select><select value={eventType} onChange={event=>setEventType(event.target.value)}>{eventTypes.map(value=><option key={value}>{value}</option>)}</select><select value={active} onChange={event=>setActive(event.target.value)}><option>All</option><option>Active</option><option>Inactive</option></select><select value={sort} onChange={event=>setSort(event.target.value)}><option>Display Order</option><option>Service Name</option><option>Category</option><option>Price</option></select></div><div className="service-cards">{rows.map(record=><article key={record.id}><span>{shown(record.fields.Category)}</span><h3>{shown(record.fields["Service Name"])}</h3><p>{shown(record.fields.Description)}</p><div><b>{new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(Number(record.fields["Standard Unit Price"]||0))}</b><small>Cost {new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(Number(record.fields["Standard Unit Cost"]||0))}</small></div><p>{Boolean(record.fields.Taxable)?"Taxable":"Not taxable"} · {Boolean(record.fields["Optional by Default"])?"Optional":"Standard"} · {Boolean(record.fields.Active)?"Active":"Inactive"}</p><footer><button onClick={()=>onEdit(record)}>Edit</button><button onClick={()=>onDuplicate(record)}>Duplicate</button>{Boolean(record.fields.Active)&&<button onClick={()=>onArchive(record)}>Deactivate</button>}<button className="danger" onClick={()=>onDelete(record)}>Delete</button></footer></article>)}</div></section>}

function RecordTable({ table, records, onView, onEdit, onDelete, onBudget }: { table: string; records: RecordRow[]; onView: (r: RecordRow) => void; onEdit: (r: RecordRow) => void; onDelete: (r: RecordRow) => void; onBudget: (r: RecordRow) => void }) {
  const fields = displayFields[table] || [];
  return <section className="table-card"><div className="table-tools"><span><b>{records.length}</b> records synced from Airtable</span></div><div className="table-wrap"><table><thead><tr>{fields.map((f) => <th key={f}>{f === "Rental Price" ? "Rental Price per Unit" : f}</th>)}<th /></tr></thead><tbody>{records.map((r) => <tr key={r.id}>{fields.map((f) => <td key={f}>{table==="Inventory"&&f==="Photo"?<InventoryThumbnail value={r.fields.Photo} name={r.fields["Item Name"]}/>:f === statusField[table] ? <span className="pill">{tableValue(r,f)}</span> : tableValue(r,f)}</td>)}<td className="row-actions">{table === "Events" && <button className="budget-link" onClick={() => onBudget(r)}>Open Workspace</button>}<button onClick={() => onView(r)}>View</button><button className="edit" onClick={() => onEdit(r)}>Edit</button><button className="danger" onClick={() => onDelete(r)}>Delete</button></td></tr>)}</tbody></table>{!records.length && <div className="no-records">No matching records found in Airtable.</div>}</div></section>;
}

function Reports({ payments }: { payments: RecordRow[] }) {
  const paid = payments.filter((p) => p.fields["Payment Status"] === "Paid").reduce((a,p) => a + Number(p.fields["Payment Amount"] || 0), 0);
  const pending = payments.filter((p) => ["Pending", "Overdue", "Partially Paid"].includes(String(p.fields["Payment Status"]))).reduce((a,p) => a + Number(p.fields["Payment Amount"] || 0), 0);
  const methods = ["E-Transfer", "Credit Card", "Cash", "Bank Transfer"].map((m) => ({ name:m, value: payments.filter((p) => p.fields["Payment Method"] === m).reduce((a,p) => a + Number(p.fields["Payment Amount"] || 0), 0) }));
  const max = Math.max(1, ...methods.map((m) => m.value));
  return <div className="report-grid"><div className="report-brand"><img src="/eventart-logo-transparent.png" alt="EventArt"/><div><strong>EventArt</strong><span>Luxury Event Design & Styling</span></div></div><div className="metrics report-metrics"><Metric label="Total collected" value={money(paid)} note="Paid transactions" /><Metric label="Pending payments" value={money(pending)} note="Requires follow-up" /></div><section className="card span2"><CardHead title="Revenue by payment method" /><div className="bars">{methods.map((m) => <div key={m.name}><span>{m.name}</span><i><b style={{ width: `${(m.value/max)*100}%` }} /></i><strong>{money(m.value)}</strong></div>)}</div></section></div>;
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
