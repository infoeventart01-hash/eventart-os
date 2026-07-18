import { notFound, redirect } from "next/navigation";

const labels: Record<string, string> = {
  clients: "Clients", events: "Events", budgets: "Budgets & Proposals", tasks: "Tasks",
  calendar: "Calendar", kanban: "Kanban Board", guests: "Guests", "seating-chart": "Seating Chart",
  vendors: "Vendors", inventory: "Inventory", "rental-orders": "Rental Orders", payments: "Payments",
  "service-catalog": "Service Catalog", "design-studio": "Design Studio", reports: "Reports",
  "user-management": "User Management",
};

export default async function DirectView({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  const label = labels[view];
  if (!label) notFound();
  redirect(`/?view=${encodeURIComponent(label)}`);
}
