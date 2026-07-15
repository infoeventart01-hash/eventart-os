import PublicSeatingExperience from "@/app/PublicSeatingExperience";

export default async function SeatingPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <PublicSeatingExperience eventId={eventId}/>;
}
