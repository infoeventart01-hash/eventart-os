"use client";

import { useEffect, useMemo, useState } from "react";
import type { AirtableRow } from "./RecordForm";

const responseBody = async (response: Response) => {
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json().catch(() => ({})) : { error: await response.text().catch(() => "") };
};

function normalizedCanvaUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLocaleLowerCase();
    if (url.protocol !== "https:" || (host !== "canva.com" && !host.endsWith(".canva.com"))) return "";
    return url.toString();
  } catch { return ""; }
}

async function copyText(value: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

export default function CanvaSeatingDesign({ event, onChanged }: { event: AirtableRow; onChanged: () => Promise<void> }) {
  const savedLink = String(event.fields["Seating Canva Link"] || "").trim();
  const [value, setValue] = useState(savedLink);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const validLink = useMemo(() => normalizedCanvaUrl(value), [value]);

  useEffect(() => { setValue(savedLink); }, [savedLink]);

  async function update(link: string | null) {
    const response = await fetch("/api/airtable", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table: "Events", id: event.id, fields: { "Seating Canva Link": link } }) });
    const data = await responseBody(response) as { error?: string | { message?: string } };
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "Unable to save the Canva link.");
  }

  async function save() {
    if (busy) return;
    const link = normalizedCanvaUrl(value);
    if (!link) { setNotice({ kind: "error", text: "Enter a valid HTTPS Canva link, such as https://www.canva.com/design/…" }); return; }
    setBusy(true); setNotice(null);
    try { await update(link); setValue(link); await onChanged(); setNotice({ kind: "success", text: "Canva seating design link saved to Airtable." }); }
    catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to save the Canva link." }); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!validLink) { setNotice({ kind: "error", text: "Save a valid Canva link before copying it." }); return; }
    setNotice(await copyText(validLink) ? { kind: "success", text: "Canva link copied." } : { kind: "error", text: "Your browser could not copy the Canva link." });
  }

  async function remove() {
    if (!savedLink || busy || !window.confirm("Remove the saved Canva seating design link from this event?")) return;
    setBusy(true); setNotice(null);
    try { await update(null); setValue(""); await onChanged(); setNotice({ kind: "success", text: "Canva seating design link removed." }); }
    catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to remove the Canva link." }); }
    finally { setBusy(false); }
  }

  return <section className="canva-seating-card">
    <div><p className="eyebrow">SEATING SIGN DESIGN</p><h2>Canva Seating Design</h2><p>Generate and download the seating QR code, then place it into your Canva seating-sign design.</p>
      <label><span>Canva Link</span><input type="url" inputMode="url" value={value} onChange={event => { setValue(event.target.value); setNotice(null); }} placeholder="https://www.canva.com/design/…" aria-invalid={Boolean(value.trim() && !validLink)}/></label>
      {!savedLink && !value && <div className="canva-empty">No Canva seating design is linked yet.</div>}{notice && <div className={`qr-notice ${notice.kind}`}>{notice.text}</div>}
      <div className="qr-actions"><button className="gold-button" disabled={busy || !validLink || validLink === savedLink} onClick={save}>{busy ? "Saving…" : "Save Link"}</button>{validLink ? <a href={validLink} target="_blank" rel="noopener noreferrer">Open in Canva</a> : <button disabled>Open in Canva</button>}<button disabled={!validLink || busy} onClick={copy}>Copy Link</button><button className="danger" disabled={!savedLink || busy} onClick={remove}>Remove Link</button></div>
    </div>
    <aside><b>Recommended Canva sizes</b><span>5 × 7 in</span><span>8 × 10 in</span><span>11 × 14 in</span><span>18 × 24 in</span></aside>
  </section>;
}
