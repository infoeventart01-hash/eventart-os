"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  buildPaymentFields,
  readPaymentResponse,
  validatePaymentDraft,
} from "@/lib/payment-contract.mjs";

type Row = {
  id: string;
  fields: Record<string, unknown>;
  displayFields?: Record<string, string>;
  computedFields?: Record<string, number>;
};

type PaymentDraft = {
  event: string;
  budget: string;
  type: string;
  other: string;
  amount: string;
  date: string;
  due: string;
  method: string;
  status: string;
  reference: string;
  notes: string;
};

const str = (value: unknown) => Array.isArray(value) ? String(value[0] || "") : String(value ?? "");
const ids = (row: Row | undefined, field: string) => Array.isArray(row?.fields[field]) ? row!.fields[field] as string[] : [];
const cad = (value: unknown) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(value) || 0);
const esc = (value: unknown) => str(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function errorMessage(value: unknown, fallback = "Unable to record payment."): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const candidate = value as { error?: unknown; message?: unknown };
    if (candidate.error) return errorMessage(candidate.error, fallback);
    if (typeof candidate.message === "string") return candidate.message;
  }
  return fallback;
}

function emptyDraft(): PaymentDraft {
  return {
    event: "",
    budget: "",
    type: PAYMENT_TYPES[0],
    other: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    due: "",
    method: "E-Transfer",
    status: "Paid",
    reference: "",
    notes: "",
  };
}

export { PAYMENT_TYPES };

export default function PaymentsWorkspace({ payments, recordedBy, onChanged }: { payments: Row[]; recordedBy: string; onChanged: () => void }) {
  const [events, setEvents] = useState<Row[]>([]);
  const [clients, setClients] = useState<Row[]>([]);
  const [budgets, setBudgets] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<PaymentDraft>(emptyDraft);
  const [filters, setFilters] = useState({ event: "", type: "", status: "" });
  const requestId = useRef("");

  useEffect(() => {
    Promise.all(["Events", "Clients", "Budgets", "Budget Items"].map(async table => {
      const response = await fetch(`/api/airtable?table=${encodeURIComponent(table)}&pageSize=100&resolveLinks=1${table === "Events" ? "&financialSummary=1" : ""}`);
      const data = await readPaymentResponse(response);
      if (!response.ok) throw new Error(errorMessage(data, `Unable to load ${table}.`));
      return Array.isArray(data.records) ? data.records as Row[] : [];
    })).then(([eventRows, clientRows, budgetRows, itemRows]) => {
      setEvents(eventRows);
      setClients(clientRows);
      setBudgets(budgetRows);
      setItems(itemRows);
    }).catch(error => setNotice(errorMessage(error)));
  }, [payments.length]);

  const event = events.find(row => row.id === form.event);
  const client = clients.find(row => ids(event, "Clients").includes(row.id));
  const relatedBudgets = budgets.filter(row => ids(row, "Event").includes(form.event));
  const budget = relatedBudgets.find(row => row.id === form.budget);
  const eventPayments = payments.filter(row => ids(row, "Event").includes(form.event));
  const errors = validatePaymentDraft(form);
  const canSubmit = Object.keys(errors).length === 0 && !busy;

  const signed = (row: Row) => str(row.fields["Payment Type"]) === "Refund"
    ? -Math.abs(Number(row.fields["Payment Amount"]) || 0)
    : Number(row.fields["Payment Amount"]) || 0;
  const settled = (row: Row) => ["Paid", "Refunded"].includes(str(row.fields["Payment Status"]));
  const paid = eventPayments.filter(settled).reduce((sum, row) => sum + signed(row), 0);
  const total = Number(budget?.fields["Total Client Price"] || event?.computedFields?.["Total Contract"] || event?.fields["Total Contract"] || 0);
  const amount = Number(form.amount || 0);
  const newBalance = Math.max(0, total - paid - (form.status === "Paid" ? (form.type === "Refund" ? -amount : amount) : 0));

  const rows = useMemo(() => [...payments]
    .filter(row => (!filters.event || ids(row, "Event").includes(filters.event))
      && (!filters.type || row.fields["Payment Type"] === filters.type)
      && (!filters.status || row.fields["Payment Status"] === filters.status))
    .sort((a, b) => str(b.fields["Payment Date"]).localeCompare(str(a.fields["Payment Date"]))), [payments, filters]);

  const received = payments
    .filter(row => row.fields["Payment Type"] !== "Refund" && row.fields["Payment Status"] === "Paid")
    .reduce((sum, row) => sum + Number(row.fields["Payment Amount"] || 0), 0);
  const refunds = payments
    .filter(row => row.fields["Payment Type"] === "Refund" && settled(row))
    .reduce((sum, row) => sum + Math.abs(Number(row.fields["Payment Amount"] || 0)), 0);

  function openPaymentForm() {
    setForm(emptyDraft());
    requestId.current = `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setNotice("");
    setOpen(true);
  }

  function selectEvent(eventId: string) {
    setForm(current => ({ ...current, event: eventId, budget: "", reference: "" }));
  }

  function selectBudget(budgetId: string) {
    const selected = relatedBudgets.find(row => row.id === budgetId);
    const proposalNumber = str(selected?.fields["Proposal Number"]);
    setForm(current => ({ ...current, budget: budgetId, reference: current.reference || proposalNumber }));
  }

  async function save(eventSubmission: FormEvent<HTMLFormElement>) {
    eventSubmission.preventDefault();
    if (busy || Object.keys(errors).length) return;
    setBusy(true);
    setNotice("");
    try {
      const fields = buildPaymentFields(form, {
        clientId: client?.id,
        proposalNumber: str(budget?.fields["Proposal Number"]),
        recordedBy,
      });
      const response = await fetch("/api/airtable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "Payments", requestId: requestId.current, fields }),
      });
      const data = await readPaymentResponse(response);
      if (!response.ok) throw new Error(errorMessage(data));
      setOpen(false);
      setNotice("Payment recorded successfully. The receipt action is ready.");
      onChanged();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function print(row: Row, kind: "invoice" | "receipt") {
    const linkedEvent = events.find(record => ids(row, "Event").includes(record.id));
    const linkedClient = clients.find(record => ids(row, "Client").includes(record.id));
    const linkedBudget = budgets.find(record => ids(row, "Proposal / Budget").includes(record.id));
    const proposalNumber = str(row.fields["Proposal Number"] || linkedBudget?.fields["Proposal Number"]);
    const number = str(row.fields[kind === "invoice" ? "Invoice Number" : "Receipt Number"]);
    const lineItems = items.filter(record => ids(record, "Budget").includes(linkedBudget?.id || "") && record.fields["Included in Proposal"] !== false);
    const popup = window.open("", "_blank", "width=900,height=900");
    if (!popup) { setNotice("Allow pop-ups to preview and download the document."); return; }
    const lines = (kind === "invoice" && lineItems.length ? lineItems : [row]).map(record => `<tr><td>${esc(record === row ? row.fields["Payment Type"] : record.fields["Item / Service"])}</td><td>${cad(record === row ? Math.abs(Number(row.fields["Payment Amount"])) : record.fields["Client Line Total"])}</td></tr>`).join("");
    popup.document.write(`<!doctype html><html><head><title>EventArt_${kind}_${esc(number)}.pdf</title><style>@page{size:A4;margin:16mm}body{font:14px Arial;color:#17150f}.doc{max-width:800px;margin:auto;padding:32px}.head{display:flex;justify-content:space-between;border-bottom:2px solid #b08b35}.head img{width:150px;height:80px;object-fit:contain}h1{font:32px Georgia}table{width:100%;border-collapse:collapse;margin:30px 0}th,td{padding:12px;border-bottom:1px solid #ddd;text-align:left}td:last-child,th:last-child{text-align:right}.foot{text-align:center;border-top:1px solid #b08b35;padding:18px}.print{position:fixed;right:15px}@media print{.print{display:none}.doc{padding:0}}</style></head><body><button class="print" onclick="window.print()">Download / Print PDF</button><main class="doc"><header class="head"><img src="${location.origin}/eventart-logo-transparent.png"><div><h1>${kind === "invoice" ? "INVOICE" : "PAYMENT RECEIPT"}</h1><b>${esc(number)}</b></div></header><p><b>${esc(linkedClient?.fields["Client Name"] || "EventArt Client")}</b><br>${esc(linkedEvent?.fields["Event Name"])}<br>Proposal: ${esc(proposalNumber || "Event-level")}</p><table><thead><tr><th>Description</th><th>Total</th></tr></thead><tbody>${lines}</tbody></table><p><b>Payment status:</b> ${esc(row.fields["Payment Status"])}</p><footer class="foot">Prepared by EventArt</footer></main></body></html>`);
    popup.document.close();
  }

  return <div className="payments-module">
    <div className="payment-metrics">
      <Metric label="Total received" value={received} />
      <Metric label="Total refunds" value={refunds} />
      <Metric label="Net payments" value={received - refunds} />
      <Metric label="Outstanding balance" value={events.reduce((sum, row) => sum + Number(row.computedFields?.["Balance Due"] || 0), 0)} />
    </div>
    <div className="payment-toolbar">
      <select aria-label="Filter by event" value={filters.event} onChange={event => setFilters({ ...filters, event: event.target.value })}><option value="">All events</option>{events.map(row => <option key={row.id} value={row.id}>{str(row.fields["Event Name"])}</option>)}</select>
      <select aria-label="Filter by payment type" value={filters.type} onChange={event => setFilters({ ...filters, type: event.target.value })}><option value="">All types</option>{PAYMENT_TYPES.map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Filter by status" value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option>{PAYMENT_STATUSES.map(value => <option key={value}>{value}</option>)}</select>
      <button className="gold-button" onClick={openPaymentForm}>+ Record Payment</button>
    </div>
    {notice && <div className="notice" role="status">{notice}</div>}
    <div className="table-card"><div className="table-wrap"><table><thead><tr>{["Payment Date", "Payment Number", "Client", "Event", "Proposal Number", "Invoice Number", "Payment Type", "Method", "Amount", "Status", "Receipt", "Actions"].map(value => <th key={value}>{value}</th>)}</tr></thead><tbody>{rows.map(row => {
      const linkedEvent = events.find(record => ids(row, "Event").includes(record.id));
      const linkedClient = clients.find(record => ids(row, "Client").includes(record.id));
      return <tr key={row.id}><td>{str(row.fields["Payment Date"])}</td><td>{str(row.fields["Payment Number"] || row.fields["Payment ID"])}</td><td>{str(linkedClient?.fields["Client Name"])}</td><td>{str(linkedEvent?.fields["Event Name"])}</td><td>{str(row.fields["Proposal Number"]) || "—"}</td><td>{str(row.fields["Invoice Number"]) || "—"}</td><td>{str(row.fields["Payment Type"])}</td><td>{str(row.fields["Payment Method"])}</td><td className={row.fields["Payment Type"] === "Refund" ? "refund" : ""}>{cad(row.fields["Payment Amount"])}</td><td><span className="pill">{str(row.fields["Payment Status"])}</span></td><td>{str(row.fields["Receipt Number"]) || "—"}</td><td className="payment-actions"><button onClick={() => print(row, "invoice")}>Invoice</button><button onClick={() => print(row, "receipt")}>Receipt</button></td></tr>;
    })}</tbody></table></div></div>
    {open && <div className="record-form-overlay">
      <button className="record-form-scrim" onClick={() => setOpen(false)} aria-label="Cancel" />
      <form className="record-form payment-form" onSubmit={save} noValidate>
        <header><div><p className="eyebrow">EVENTART PAYMENTS</p><h2>Record Payment</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="Close payment form">×</button></header>
        <div className="payment-form-body">
          {notice && <div className="form-error" role="alert">{notice}</div>}
          <Block title="Payment Information">
            <Field label="Event *" error={errors.event}><select aria-invalid={Boolean(errors.event)} value={form.event} onChange={event => selectEvent(event.target.value)}><option value="">Select event</option>{events.map(row => <option key={row.id} value={row.id}>{str(row.fields["Event Name"])}</option>)}</select></Field>
            <Field label="Client"><input readOnly value={str(client?.fields["Client Name"])} placeholder={form.event ? "No linked client" : "Select an event first"} /></Field>
            <Field label="Proposal / Budget" error={errors.budget}><select aria-invalid={Boolean(errors.budget)} value={form.budget} onChange={event => selectBudget(event.target.value)} disabled={!form.event}><option value="">Event-level payment</option>{relatedBudgets.map(row => <option key={row.id} value={row.id}>{str(row.fields["Budget Name"])} · {str(row.fields["Proposal Number"])}</option>)}</select></Field>
            <Field label="Proposal Number"><input readOnly value={str(budget?.fields["Proposal Number"])} /></Field>
            <Field label="Invoice / Reference Number"><input value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} /></Field>
          </Block>
          <Block title="Payment Details">
            <Field label="Payment Type *" error={errors.type}><select aria-invalid={Boolean(errors.type)} value={form.type} onChange={event => setForm({ ...form, type: event.target.value })}>{PAYMENT_TYPES.map(value => <option key={value}>{value}</option>)}</select></Field>
            {form.type === "Other" && <Field label="Other description *" error={errors.other}><input aria-invalid={Boolean(errors.other)} value={form.other} onChange={event => setForm({ ...form, other: event.target.value })} /></Field>}
            <Field label="Amount *" error={errors.amount}><input aria-invalid={Boolean(errors.amount)} type="number" min="0.01" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} /></Field>
            <Field label="Payment Date *" error={errors.date}><input aria-invalid={Boolean(errors.date)} type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></Field>
            <Field label="Payment Method"><select value={form.method} onChange={event => setForm({ ...form, method: event.target.value })}>{PAYMENT_METHODS.map(value => <option key={value}>{value}</option>)}</select></Field>
            <Field label="Status"><select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{PAYMENT_STATUSES.map(value => <option key={value}>{value}</option>)}</select></Field>
          </Block>
          <Block title="Notes">
            <Field label="Notes"><textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></Field>
            <Field label="Recorded By"><input readOnly value={recordedBy} /></Field>
          </Block>
          <div className="payment-summary"><Metric label="Event total" value={total} /><Metric label="Total paid" value={paid} /><Metric label="Current balance" value={Math.max(0, total - paid)} /><Metric label="New balance" value={newBalance} /></div>
        </div>
        <footer className="payment-form-footer"><button type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button><button type="submit" className="gold-button" disabled={!canSubmit}>{busy ? "Recording…" : "Record Payment"}</button></footer>
      </form>
    </div>}
  </div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label><span>{label}</span>{children}{error && <small className="field-error">{error}</small>}</label>;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="payment-form-section"><h3>{title}</h3><div className="record-form-grid">{children}</div></section>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <section><span>{label}</span><b>{cad(value)}</b></section>;
}
