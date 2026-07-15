"use client";

import { useMemo, useState } from "react";
import QRCode from "qrcode";
import type { AirtableRow } from "./RecordForm";

type QRFile = { id?: string; filename?: string; url?: string; type?: string };
type Codes = { png: string; svg: string };

const text = (value: unknown) => String(value ?? "").replaceAll("_", " ").replace(/\s+/g, " ").trim();
const safeName = (value: unknown) => text(value).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "event";
const html = (value: unknown) => text(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const responseBody = async (response: Response) => {
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json().catch(() => ({})) : { error: await response.text().catch(() => "") };
};

export default function FindMySeatQR({ event, onChanged }: { event: AirtableRow; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [codes, setCodes] = useState<Codes | null>(null);
  const current = ((Array.isArray(event.fields["Seating QR Code"]) ? event.fields["Seating QR Code"] : []) as QRFile[]).at(-1);
  const publicUrl = useMemo(() => typeof window === "undefined" ? "" : `${window.location.origin}/seating/${encodeURIComponent(event.id)}`, [event.id]);

  async function makeCodes() {
    const url = publicUrl || `${window.location.origin}/seating/${encodeURIComponent(event.id)}`;
    const generated = {
      png: await QRCode.toDataURL(url, { errorCorrectionLevel: "H", width: 1400, margin: 5, color: { dark: "#111111", light: "#fffaf0" } }),
      svg: await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "H", width: 1400, margin: 5, color: { dark: "#111111", light: "#fffaf0" } }),
    };
    setCodes(generated);
    return generated;
  }

  async function generate() {
    if (busy) return;
    if (current && !window.confirm("Regenerate and replace the saved Find My Seat QR code?")) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/seating-qr/${encodeURIComponent(event.id)}`, { method: "POST" });
      const data = await responseBody(response) as { error?: unknown; png?: string; svg?: string; warning?: string };
      if (!response.ok || !data.png || !data.svg) throw new Error(typeof data.error === "string" ? data.error : "The QR code could not be saved to Airtable.");
      setCodes({ png: data.png, svg: data.svg });
      await onChanged();
      setNotice({ kind: "success", text: data.warning ? "QR code saved to Airtable. The previous attachment could not be removed." : "Find My Seat QR code generated and saved to Airtable." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to generate the QR code." });
    } finally { setBusy(false); }
  }

  async function download(data: string, filename: string, type: string) {
    const anchor = document.createElement("a");
    const blob = data.startsWith("data:") ? await (await fetch(data)).blob() : new Blob([data], { type });
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 500);
  }

  async function downloadPNG() {
    try { const generated = codes || await makeCodes(); await download(generated.png, `EventArt-Find-My-Seat-${safeName(event.fields["Event Name"])}.png`, "image/png"); }
    catch { setNotice({ kind: "error", text: "Unable to prepare the PNG download." }); }
  }
  async function downloadSVG() {
    try { const generated = codes || await makeCodes(); await download(generated.svg, `EventArt-Find-My-Seat-${safeName(event.fields["Event Name"])}.svg`, "image/svg+xml"); }
    catch { setNotice({ kind: "error", text: "Unable to prepare the SVG download." }); }
  }
  async function copyLink() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(publicUrl);
      setNotice({ kind: "success", text: "Public seating link copied." });
    } catch {
      const input = document.createElement("textarea");
      input.value = publicUrl;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      setNotice(copied ? { kind: "success", text: "Public seating link copied." } : { kind: "error", text: "Your browser could not copy the link. Open the public page and copy its address instead." });
    }
  }

  async function printCard() {
    try {
      const generated = codes || await makeCodes();
      const popup = window.open("", "_blank", "width=760,height=900");
      if (!popup) throw new Error("Allow pop-ups to print the QR card.");
      const dateValue = event.fields["Ceremony Date & Time"] || event.fields["Event Date"];
      const parsedDate = dateValue ? new Date(String(dateValue)) : null;
      const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "America/Toronto" }).format(parsedDate) : "";
      popup.document.write(`<!doctype html><html><head><title>${html(event.fields["Event Name"])} Find My Seat</title><style>@page{size:5in 7in;margin:0}*{box-sizing:border-box}body{margin:0;background:#fff;font-family:Arial;color:#111}.card{width:5in;height:7in;background:#fffaf0;border:.035in solid #c9a858;padding:.35in;text-align:center;display:flex;flex-direction:column;align-items:center}.logo{width:1.35in;height:.82in;object-fit:contain}.eyebrow{font-size:8px;letter-spacing:2px;color:#967126;margin:.17in 0}.rule{width:.75in;border-top:1px solid #c9a858}.title{font:400 28px Georgia;margin:.17in 0 .08in}.event{font:400 18px Georgia;margin:.06in 0}.instruction{font-size:11px;color:#5f5a51;margin:.08in 0 .16in}.qr{width:2.75in;height:2.75in;object-fit:contain}.details{font:11px Georgia;margin-top:.16in;line-height:1.55}.footer{margin-top:auto;font-size:7px;letter-spacing:1.2px;color:#967126;text-transform:uppercase}@media print{body{width:5in;height:7in}.print{display:none}}</style></head><body><section class="card"><img class="logo" src="${window.location.origin}/eventart-logo-transparent.png" alt="EventArt"><p class="eyebrow">LUXURY EVENT DESIGN &amp; STYLING</p><div class="rule"></div><h1 class="title">Find Your Seat</h1><h2 class="event">${html(event.fields["Event Name"])}</h2><p class="instruction">Scan the QR code and enter your name.</p><img class="qr" src="${generated.png}" alt="Find My Seat QR Code"><p class="details">${html(date)}${date && event.fields["Venue Name"] ? "<br>" : ""}${html(event.fields["Venue Name"])}</p><p class="footer">Prepared by EventArt</p></section><button class="print" onclick="window.print()">Print QR Card</button></body></html>`);
      popup.document.close();
      popup.focus();
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to prepare the QR card." }); }
  }

  async function remove() {
    if (!current || busy || !window.confirm("Remove the saved Find My Seat QR code from this event?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/airtable", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table: "Events", id: event.id, fields: { "Seating QR Code": [] } }) });
      const data = await responseBody(response) as { error?: unknown };
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Unable to remove the QR code.");
      setCodes(null);
      await onChanged();
      setNotice({ kind: "success", text: "Saved QR code removed. The public seating page remains available." });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to remove the QR code." }); }
    finally { setBusy(false); }
  }

  return <section className="find-seat-qr-card">
    <div className="find-seat-qr-copy">
      <p className="eyebrow">PUBLIC GUEST EXPERIENCE</p><h2>Find My Seat QR Code</h2>
      <p>Generate a secure QR code that opens the live, read-only seating page for this event.</p>
      <code>{publicUrl}</code>
      {notice && <div className={`qr-notice ${notice.kind}`}>{notice.text}</div>}
      <div className="qr-actions">
        <button className="gold-button" disabled={busy} onClick={generate}>{busy ? "Generating…" : current ? "Regenerate QR" : "Generate QR Code"}</button>
        <button disabled={busy} onClick={downloadPNG}>Download PNG</button><button disabled={busy} onClick={downloadSVG}>Download SVG</button>
        <button disabled={busy} onClick={printCard}>Print QR Card</button><button disabled={busy} onClick={copyLink}>Copy Link</button>
        <a href={publicUrl} target="_blank" rel="noreferrer">Open Seating Page</a>
        {current && <button className="danger" disabled={busy} onClick={remove}>Remove Saved QR</button>}
      </div>
    </div>
    <div className="qr-preview">{current?.url ? <img src={current.url} alt={`Find My Seat QR Code for ${text(event.fields["Event Name"])}`}/> : codes?.png ? <img src={codes.png} alt="Generated Find My Seat QR Code"/> : <div><b>EA</b><span>Generate the event QR code</span></div>}{current?.url && <small>Saved in Airtable</small>}</div>
  </section>;
}
