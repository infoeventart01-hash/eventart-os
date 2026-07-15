export type FinancialRecord = {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
  computedFields?: Record<string, number>;
};

export type FinancialTotals = {
  revenueReceived: number;
  outstanding: number;
};

const budgetPriority: Record<string, number> = { Approved: 0, Sent: 1, "In Review": 2, Draft: 3 };
const receivedPaymentStatuses = new Set(["Paid"]);
const inactiveEventStatuses = new Set(["Event Completed", "Cancelled", "Archived"]);

function linkedTo(record: FinancialRecord, eventId: string) {
  return Array.isArray(record.fields.Event) && record.fields.Event.includes(eventId);
}

function amount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function calculateFinancialSummary(events: FinancialRecord[], budgets: FinancialRecord[], payments: FinancialRecord[]) {
  const records = events.map(event => {
    const selectedBudget = budgets
      .filter(budget => linkedTo(budget, event.id))
      .sort((a, b) => (budgetPriority[String(a.fields.Status)] ?? 99) - (budgetPriority[String(b.fields.Status)] ?? 99)
        || String(b.createdTime || "").localeCompare(String(a.createdTime || "")))[0];
    const totalContract = selectedBudget
      ? amount(selectedBudget.fields["Total Client Price"])
      : amount(event.fields["Total Contract"]);
    const amountPaid = payments
      .filter(payment => linkedTo(payment, event.id) && receivedPaymentStatuses.has(String(payment.fields["Payment Status"])))
      .reduce((sum, payment) => sum + amount(payment.fields["Payment Amount"]), 0);
    return {
      ...event,
      computedFields: {
        "Total Contract": totalContract,
        "Amount Paid": amountPaid,
        "Balance Due": Math.max(0, totalContract - amountPaid),
      },
    };
  });

  const financialTotals: FinancialTotals = {
    revenueReceived: payments
      .filter(payment => receivedPaymentStatuses.has(String(payment.fields["Payment Status"])))
      .reduce((sum, payment) => sum + amount(payment.fields["Payment Amount"]), 0),
    outstanding: records
      .filter(event => !inactiveEventStatuses.has(String(event.fields["Event Status"])))
      .reduce((sum, event) => sum + Math.max(0, event.computedFields["Balance Due"]), 0),
  };

  return { records, financialTotals };
}
