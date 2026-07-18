import { notFound, redirect } from "next/navigation";

export default async function DirectEventWorkspace({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!/^rec[A-Za-z0-9]{14}$/.test(eventId)) notFound();
  redirect(`/?view=Events&event=${encodeURIComponent(eventId)}`);
}
