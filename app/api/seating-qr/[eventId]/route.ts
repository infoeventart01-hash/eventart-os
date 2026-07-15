import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

type AirtableAttachment = { id?: string; filename?: string; url?: string; type?: string };
type AirtableRecord = { id?: string; fields?: Record<string, unknown> };

const BASE_ID = (import.meta.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || "").trim();
const TOKEN = (import.meta.env.AIRTABLE_TOKEN || process.env.AIRTABLE_TOKEN || "").trim();
const QR_FIELD = "Seating QR Code";

function headers() { return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }; }

function safeAirtableError(data: unknown, status: number) {
  const error = (data as { error?: { type?: unknown; message?: unknown } })?.error;
  const type = typeof error?.type === "string" ? error.type : `HTTP_${status}`;
  const message = typeof error?.message === "string" ? error.message : "Airtable could not save the QR code";
  console.error("Airtable seating QR error", { type, message });
  return message;
}

function filename(value: unknown) {
  const name = String(value || "event").replaceAll("_", " ").trim();
  return `EventArt-Find-My-Seat-${name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "event"}.png`;
}

export async function POST(request: NextRequest, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params;
  if (!TOKEN || !/^app[A-Za-z0-9]{14}$/.test(BASE_ID)) return NextResponse.json({ error: "Airtable QR storage is not configured." }, { status: 503 });
  if (!/^rec[A-Za-z0-9]{14}$/.test(eventId)) return NextResponse.json({ error: "A valid event is required to generate a QR code." }, { status: 400 });

  try {
    const eventResponse = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/Events/${encodeURIComponent(eventId)}`, { headers: headers(), cache: "no-store" });
    const eventData = await eventResponse.json().catch(() => ({})) as AirtableRecord;
    if (!eventResponse.ok) return NextResponse.json({ error: safeAirtableError(eventData, eventResponse.status) }, { status: eventResponse.status });

    // This follows the local development origin and the deployed application origin automatically.
    const publicUrl = new URL(`/seating/${encodeURIComponent(eventId)}`, new URL(request.url).origin).toString();
    const options = { errorCorrectionLevel: "H" as const, width: 1400, margin: 5, color: { dark: "#111111", light: "#fffaf0" } };
    const [png, svg] = await Promise.all([QRCode.toDataURL(publicUrl, options), QRCode.toString(publicUrl, { ...options, type: "svg" })]);
    const encodedPng = png.slice(png.indexOf(",") + 1);
    const uploadResponse = await fetch(`https://content.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(eventId)}/${encodeURIComponent(QR_FIELD)}/uploadAttachment`, {
      method: "POST", headers: headers(), body: JSON.stringify({ contentType: "image/png", filename: filename(eventData.fields?.["Event Name"]), file: encodedPng }),
    });
    const uploadData = await uploadResponse.json().catch(() => ({})) as AirtableRecord;
    if (!uploadResponse.ok) return NextResponse.json({ error: safeAirtableError(uploadData, uploadResponse.status) }, { status: uploadResponse.status });

    const oldAttachments = (Array.isArray(eventData.fields?.[QR_FIELD]) ? eventData.fields?.[QR_FIELD] : []) as AirtableAttachment[];
    const oldIds = new Set(oldAttachments.map(attachment => attachment.id).filter(Boolean));
    const refreshedResponse = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/Events/${encodeURIComponent(eventId)}`, { headers: headers(), cache: "no-store" });
    const refreshedData = await refreshedResponse.json().catch(() => ({})) as AirtableRecord;
    if (!refreshedResponse.ok) return NextResponse.json({ error: safeAirtableError(refreshedData, refreshedResponse.status) }, { status: refreshedResponse.status });
    const attachments = (Array.isArray(refreshedData.fields?.[QR_FIELD]) ? refreshedData.fields?.[QR_FIELD] : []) as AirtableAttachment[];
    const newest = attachments.find(attachment => attachment.id && !oldIds.has(attachment.id)) || attachments.at(-1);
    let warning = "";
    if (newest?.id) {
      const replaceResponse = await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/Events/${encodeURIComponent(eventId)}`, {
        method: "PATCH", headers: headers(), body: JSON.stringify({ fields: { [QR_FIELD]: [{ id: newest.id }] }, typecast: false }),
      });
      const replaceData = await replaceResponse.json().catch(() => ({}));
      if (!replaceResponse.ok) warning = safeAirtableError(replaceData, replaceResponse.status);
    }
    return NextResponse.json({ publicUrl, png, svg, attachment: newest || null, warning }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "The QR code could not be generated or saved." }, { status: 502 });
  }
}
