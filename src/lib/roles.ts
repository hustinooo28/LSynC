import type { UserRole, ViewState } from "@/types";

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  secretary: "Secretary",
  treasurer: "Treasurer",
  auditor: "Auditor",
  "board-member": "Board Member",
};

const ALL: UserRole[] = ["admin", "secretary", "treasurer", "auditor", "board-member"];
const FINANCE: UserRole[] = ["admin", "treasurer", "auditor"];
const RECORDS: UserRole[] = ["admin", "secretary"];

/** Which roles may open each staff-only view. Public views are absent. */
export const VIEW_ROLES: Partial<Record<ViewState, UserRole[]>> = {
  "student-management": RECORDS,
  "attendance-management": RECORDS,
  "report-management": RECORDS,
  "requirement-files-management": ["admin"],
  "contribution-management": FINANCE,
  "payment-management": FINANCE,
  "transaction-management": FINANCE,
  "event-management": ALL,
  "feedback-management": ALL,
};

/** `undefined` for public views; otherwise whether `role` may open `view`. */
export function canAccess(role: UserRole | null, view: ViewState): boolean | undefined {
  const allowed = VIEW_ROLES[view];
  if (!allowed) return undefined;
  return role !== null && allowed.includes(role);
}
