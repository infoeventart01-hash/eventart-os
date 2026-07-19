"use client";

import type { AirtableRow } from "./RecordForm";

function display(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (!value.length) return "—";
    if (value.every(item => typeof item === "string")) return value.join(", ");
    return value.map(item => typeof item === "object" && item && "filename" in item ? String((item as { filename?: unknown }).filename || "Attachment") : "Attachment").join(", ");
  }
  if (typeof value === "object") return "Attachment or linked data";
  return String(value).replaceAll("_", " ").replace(/\s+/g, " ").trim() || "—";
}

export default function RecordDetails({ table, record, onClose, onEdit }: { table: string; record: AirtableRow; onClose: () => void; onEdit: () => void }) {
  const fields = Object.entries(record.fields);
  return <div className="record-details-overlay">
    <button className="record-details-scrim" aria-label="Close record details" onClick={onClose} />
    <section role="dialog" aria-modal="true" aria-labelledby="record-details-title">
      <header><div><p className="eyebrow">AIRTABLE RECORD</p><h2 id="record-details-title">{table.replace(/s$/, "")} details</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></header>
      <dl>{fields.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{record.displayFields?.[name] || display(value)}</dd></div>)}</dl>
      <footer><button type="button" onClick={onClose}>Close</button><button type="button" className="gold-button" onClick={onEdit}>Edit</button></footer>
    </section>
  </div>;
}

