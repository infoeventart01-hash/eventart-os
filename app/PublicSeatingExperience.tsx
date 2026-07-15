"use client";

import { useEffect, useMemo, useState } from "react";

type Table = { name: string; number: string; type: string; location: string; vip: boolean; guests?: string[] };
type Guest = { name: string; table: Table | null; seatNumber: string; vip: boolean };
type Payload = { event: { name: string; date: string; venue: string }; guests: Guest[]; tables: Table[] };

const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
const formattedDate = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "America/Toronto" }).format(date);
};
const tableLabel = (table: Table) => table.name || (table.number ? `Table ${table.number}` : "Table assignment");

export default function PublicSeatingExperience({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [query, setQuery] = useState("");
  const [directory, setDirectory] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/public-seating/${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Seating information is temporarily unavailable.");
        if (active) setData(body as Payload);
      })
      .catch(reason => active && setError(reason instanceof Error ? reason.message : "Seating information is temporarily unavailable."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [eventId]);

  const matches = useMemo(() => {
    const search = normalize(query);
    return search && data ? data.guests.filter(guest => normalize(guest.name).includes(search)) : [];
  }, [data, query]);

  if (loading) return <main className="public-seating public-seating-state"><img src="/eventart-logo-transparent.png" alt="EventArt"/><div className="gold-spinner"/><p>Preparing the seating directory…</p></main>;
  if (error || !data) return <main className="public-seating public-seating-state"><img src="/eventart-logo-transparent.png" alt="EventArt"/><h1>This event could not be found.</h1><p>{error || "Seating information is temporarily unavailable."}</p></main>;

  return <main className="public-seating">
    <header className="public-seating-hero">
      <img src="/eventart-logo-transparent.png" alt="EventArt"/>
      <p className="eyebrow">LUXURY EVENT DESIGN & STYLING</p>
      <h1>Welcome to {data.event.name || "Your Celebration"}</h1>
      <div><span>{formattedDate(data.event.date)}</span>{data.event.venue && <span>{data.event.venue}</span>}</div>
      <p>Please search your name below to find your assigned table.</p>
    </header>

    <section className="seat-finder" aria-labelledby="find-seat-title">
      <p className="eyebrow">FIND MY SEAT</p>
      <h2 id="find-seat-title">Your place awaits</h2>
      <label><span>Enter your name</span><input autoComplete="name" value={query} onChange={event => setQuery(event.target.value)} placeholder="Enter your name"/></label>
      {!data.guests.length && <div className="seat-empty">No seating information is available yet.</div>}
      {query.trim() && data.guests.length > 0 && matches.length === 0 && <div className="seat-empty">No guest was found. Please check the spelling or ask the event host.</div>}
      <div className="seat-results" aria-live="polite">{matches.map((guest, index) => <article key={`${guest.name}-${index}`}>
        <div><p className="eyebrow">WELCOME</p><h3>{guest.name}</h3></div>
        {guest.table ? <dl><div><dt>Table</dt><dd>{tableLabel(guest.table)}</dd></div>{guest.table.number && guest.table.name && <div><dt>Table Number</dt><dd>{guest.table.number}</dd></div>}{guest.seatNumber && <div><dt>Seat</dt><dd>{guest.seatNumber}</dd></div>}{guest.table.location && <div><dt>Location</dt><dd>{guest.table.location}</dd></div>}</dl> : <p className="unassigned-seat">Your seating assignment is not available yet. Please contact the event host.</p>}
        {(guest.vip || guest.table?.vip) && <span className="vip-seat-badge">VIP</span>}
      </article>)}</div>
    </section>

    <section className="table-directory">
      <button aria-expanded={directory} onClick={() => setDirectory(value => !value)}>{directory ? "Hide Table Directory" : "View All Tables"}<span>{directory ? "−" : "+"}</span></button>
      {directory && <div>{data.tables.length ? data.tables.map((table, index) => <article key={`${table.name}-${table.number}-${index}`}>
        <header><div><p className="eyebrow">{table.type || "GUEST TABLE"}</p><h2>{tableLabel(table)}</h2></div>{table.vip && <span className="vip-seat-badge">VIP TABLE</span>}</header>
        {(table.number || table.location) && <p>{table.number && table.name ? `Table ${table.number}` : ""}{table.number && table.name && table.location ? " · " : ""}{table.location}</p>}
        <h3>Guests</h3>
        {table.guests?.length ? <ul>{table.guests.map(name => <li key={name}>{name}</li>)}</ul> : <p>No assigned guests are listed yet.</p>}
      </article>) : <div className="seat-empty">No seating information is available yet.</div>}</div>}
    </section>
    <footer><img src="/eventart-logo-transparent.png" alt=""/><p>Prepared with care by EventArt</p><span>Luxury Event Design & Styling</span></footer>
  </main>;
}
