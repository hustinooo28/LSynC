import type { ContributionRecord } from "@/types";

/**
 * Status chip shared by the public record and contribution management:
 * nothing paid -> Unpaid, balance left -> Partial Payment, else Fully Paid.
 */
export function contributionStatus(
  record: Pick<ContributionRecord, "amountPaid" | "remainingBalance">,
): { label: string; className: string } {
  if (record.amountPaid <= 0) return { label: "Unpaid", className: "chip chip-danger" };
  if (record.remainingBalance > 0) return { label: "Partial Payment", className: "chip chip-warning" };
  return { label: "Fully Paid", className: "chip chip-success" };
}

/** Sums paid / required / balance across a student's contribution records. */
export function calculateContributionTotals(records: ContributionRecord[]) {
  return records.reduce(
    (totals, r) => ({
      totalPaid: totals.totalPaid + r.amountPaid,
      totalRequired: totals.totalRequired + r.requiredAmount,
      totalBalance: totals.totalBalance + r.remainingBalance,
    }),
    { totalPaid: 0, totalRequired: 0, totalBalance: 0 },
  );
}
