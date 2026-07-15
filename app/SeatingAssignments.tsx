"use client";

import { useEffect, useMemo, useState } from "react";
import type { AirtableRow } from "./RecordForm";

const links = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const guestName = (guest: AirtableRow) => {
  const parts = [guest.fields["First Name"], guest.fields["Last Name"]].map(value => String(value || "").trim()).filter(Boolean);
  return String(parts.length ? parts.join(" ") : guest.fields["Full Name"] || "Guest").replaceAll("_", " ").replace(/\s+/g, " ").trim();
};
const tableName = (table: AirtableRow) => String(table.fields["Table Name"] || (table.fields["Table Number"] ? `Table ${table.fields["Table Number"]}` : "Seating table"));

export default function SeatingAssignments({ eventId, tables, guests, search, onChanged, onEditGuest, onEditTable, onDeleteTable }: {
  eventId: string;
  tables: AirtableRow[];
  guests: AirtableRow[];
  search: string;
  onChanged: () => Promise<void>;
  onEditGuest: (guest: AirtableRow) => void;
  onEditTable: (table: AirtableRow) => void;
  onDeleteTable: (table: AirtableRow) => void;
}) {
  const eventTables = useMemo(() => tables.filter(table => links(table.fields.Event).includes(eventId)), [tables, eventId]);
  const eventGuests = useMemo(() => guests.filter(guest => links(guest.fields.Event).includes(eventId)), [guests, eventId]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    eventGuests.forEach(guest => { next[guest.id] = links(guest.fields["Seating Chart"])[0] || ""; });
    setChoices(next);
  }, [eventGuests]);

  const assignedTo = (tableId: string) => eventGuests.filter(guest => links(guest.fields["Seating Chart"]).includes(tableId));
  const unassigned = eventGuests.filter(guest => !links(guest.fields["Seating Chart"]).length);
  const query = search.trim().toLocaleLowerCase();
  const visibleTables = eventTables.filter(table => !query || tableName(table).toLocaleLowerCase().includes(query) || assignedTo(table.id).some(guest => guestName(guest).toLocaleLowerCase().includes(query)));
  const visibleUnassigned = unassigned.filter(guest => !query || guestName(guest).toLocaleLowerCase().includes(query));

  async function saveAssignment(guest: AirtableRow, targetId: string) {
    if (busy) return;
    const currentId = links(guest.fields["Seating Chart"])[0] || "";
    const target = eventTables.find(table => table.id === targetId);
    if (targetId && !target) { setNotice({ kind: "error", text: "The selected table does not belong to this event." }); return; }
    let allowOverbook = false;
    if (target && currentId !== targetId) {
      const count = assignedTo(targetId).length;
      const capacity = Number(target.fields.Capacity || 0);
      if (capacity > 0 && count >= capacity) {
        if (!window.confirm(`${tableName(target)} is full. Assign ${guestName(guest)} anyway?`)) return;
        allowOverbook = true;
      }
    }
    setBusy(guest.id); setNotice(null);
    try {
      const response = await fetch("/api/airtable", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table: "Guests", id: guest.id, fields: { "Seating Chart": targetId ? [targetId] : [] }, allowOverbook }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "Unable to update the seating assignment.");
      await onChanged();
      const action = !target ? "was moved to Unassigned Guests" : currentId ? `was moved to ${tableName(target)}` : `was added to ${tableName(target)}`;
      setNotice({ kind: "success", text: `${guestName(guest)} ${action}.` });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to update the seating assignment." }); }
    finally { setBusy(""); }
  }

  function AssignmentControls({ guest, assigned }: { guest: AirtableRow; assigned: boolean }) {
    const selected = choices[guest.id] || "";
    const current = links(guest.fields["Seating Chart"])[0] || "";
    return <div className="seat-assignment-actions"><select aria-label={`Assigned table for ${guestName(guest)}`} value={selected} disabled={busy === guest.id} onChange={event => setChoices(old => ({ ...old, [guest.id]: event.target.value }))}><option value="">Unassigned</option>{eventTables.map(table => { const count = assignedTo(table.id).length; const capacity = Number(table.fields.Capacity || 0); return <option key={table.id} value={table.id}>{tableName(table)}{table.fields["Table Number"] != null ? ` · Table ${table.fields["Table Number"]}` : ""} · {Math.max(0, capacity - count)} remaining</option>; })}</select><button disabled={busy === guest.id || selected === current || (!selected && !assigned)} onClick={() => saveAssignment(guest, selected)}>{busy === guest.id ? "Saving…" : assigned ? "Move" : "Assign to Table"}</button>{assigned && <button className="danger" disabled={busy === guest.id} onClick={() => saveAssignment(guest, "")}>Remove assignment</button>}<button onClick={() => onEditGuest(guest)}>Edit Guest</button></div>;
  }

  return <div className="seating-assignments">
    {notice && <div className={`workspace-message ${notice.kind}`}>{notice.text}</div>}
    <div className="seating-table-grid">{visibleTables.map(table => { const assigned = assignedTo(table.id); const capacity = Number(table.fields.Capacity || 0); const remaining = Math.max(0, capacity - assigned.length); return <article className="seating-table-card" key={table.id}><header><div><p className="eyebrow">{table.fields["Table Type"] || "SEATING TABLE"}</p><h3>{tableName(table)}</h3>{table.fields["Table Number"] != null && <span>Table {String(table.fields["Table Number"])}</span>}</div><button onClick={() => onEditTable(table)}>Edit Table</button></header><dl><div><dt>Assigned Guest Count</dt><dd>{assigned.length}</dd></div><div><dt>Capacity</dt><dd>{capacity}</dd></div><div><dt>Remaining Seats</dt><dd>{remaining}</dd></div></dl><div className="seating-guest-list">{assigned.length ? assigned.map(guest => <section key={guest.id}><div><b>{guestName(guest)}</b><span>{guest.fields["Seat Number"] == null || guest.fields["Seat Number"] === "" ? "Seat not assigned" : `Seat ${guest.fields["Seat Number"]}`}</span></div><AssignmentControls guest={guest} assigned/></section>) : <p>No guests assigned yet.</p>}</div><button className="danger table-delete" onClick={() => onDeleteTable(table)}>Delete Table</button></article>; })}</div>
    <section className="unassigned-guests"><div><p className="eyebrow">NEEDS A TABLE</p><h3>Unassigned Guests</h3><span>{unassigned.length} guest{unassigned.length === 1 ? "" : "s"}</span></div>{visibleUnassigned.length ? visibleUnassigned.map(guest => <article key={guest.id}><div><b>{guestName(guest)}</b><span>{guest.fields["Seat Number"] == null || guest.fields["Seat Number"] === "" ? "No seat number" : `Seat ${guest.fields["Seat Number"]}`}</span></div><AssignmentControls guest={guest} assigned={false}/></article>) : <p>{unassigned.length ? "No unassigned guests match your search." : "Every guest is assigned to a table."}</p>}</section>
  </div>;
}
