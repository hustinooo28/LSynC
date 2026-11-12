import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  Coins,
  CreditCard,
  FileUp,
  ListChecks,
  Pencil,
  Receipt,
  Scale,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import Page from "@/components/ui/Page";
import Modal from "@/components/ui/Modal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import SearchInput from "@/components/ui/SearchInput";
import Pagination from "@/components/ui/Pagination";
import { LoadingCard } from "@/components/ui/Skeleton";
import { Menu, MenuContent, MenuItem, MenuSeparator, RowActionsTrigger } from "@/components/ui/Menu";
import ReceiptViewer from "@/components/ReceiptViewer";
import { contributionsService, studentsService, eventsService, paymentsService, subscribeToTables } from "@/services/db";
import type { ContributionRecord, PaymentRecord, Student, Event, UserRole } from "@/types";
import { cn } from "@/lib/utils";
import { formatDate, formatPeso, today } from "@/lib/format";
import { contributionStatus } from "@/lib/contributions";
import { autoCreateReceipt, officialReceiptNumber } from "@/lib/receipts";
import { pickField, parseAmount, normalizeStudentId, expandEventGroups } from "@/lib/spreadsheet";
import { useSpreadsheetImport } from "@/hooks/useSpreadsheetImport";

interface ContributionManagementSectionProps {
  onBack: () => void;
  role: UserRole;
  staffName: string;
}

interface ContributionRow extends ContributionRecord {
  studentName: string;
  studentDisplayId: string;
}

interface EditForm {
  id: string;
  studentId: string;
  eventId: string;
  requiredAmount: number;
  amountPaid: number;
}

const PAGE_SIZE = 20;
const IMPORT_CONCURRENCY = 5;
const RECEIPT_ROLES: UserRole[] = ["admin", "treasurer", "auditor"];
// Values understood by contributionsService.getPage().
const STATUS_OPTIONS = [
  ["unpaid", "Unpaid"],
  ["partial", "Partial Payment"],
  ["paid", "Fully Paid"],
] as const;
const IMPORT_HINT =
  "Expected columns: Student ID / Name, then Event, Required Amount, Amount Paid (repeat that trio for each additional event).";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const pairKey = (studentId: string, eventId: string) => `${studentId.toLowerCase()}|${eventId.toLowerCase()}`;
const isDuplicateError = (error: unknown) =>
  error instanceof Error && error.message.includes("already has a contribution record for this event");

function StatusChip({ record }: { record: Pick<ContributionRecord, "amountPaid" | "remainingBalance"> }) {
  const status = contributionStatus(record);
  return <span className={cn("chip", status.className)}>{status.label}</span>;
}

export default function ContributionManagementSection({ onBack, role, staffName }: ContributionManagementSectionProps) {
  const [rows, setRows] = useState<ContributionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({ totalRequired: 0, totalPaid: 0, totalBalance: 0 });
  const [students, setStudents] = useState<Student[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ContributionRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  const recordedBy = staffName || "Council Officer";
  const canIssueReceipts = RECEIPT_ROLES.includes(role);
  // Skips realtime reloads while a bulk import runs; the import reloads once at the end.
  const importingRef = useRef(false);
  // Ignores responses from superseded loads (fast paging/typing).
  const requestRef = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestRef.current;
    try {
      const [pageData, totalsData, allStudents, allEvents, allPayments] = await Promise.all([
        contributionsService.getPage(page - 1, PAGE_SIZE, query, eventFilter, statusFilter),
        contributionsService.getTotals(),
        studentsService.getAll(),
        eventsService.getAll(),
        paymentsService.getAll(),
      ]);
      if (requestId !== requestRef.current) return;

      // Deletes/realtime updates can shrink the result set past the current page.
      const lastPage = Math.max(1, Math.ceil(pageData.total / PAGE_SIZE));
      if (page > lastPage) return setPage(lastPage);

      const studentById = new Map(allStudents.map((s) => [s.id, s]));
      setRows(
        pageData.data.map((record) => ({
          ...record,
          studentName: studentById.get(record.studentId)?.name ?? "Unknown Student",
          studentDisplayId: studentById.get(record.studentId)?.studentId ?? "—",
        })),
      );
      setTotal(pageData.total);
      setTotals(totalsData);
      setStudents([...allStudents].sort(byName));
      setEvents([...allEvents].sort(byName));
      setPayments(allPayments);
    } catch (error) {
      console.error("Error loading contribution records:", error);
      toast.error("Failed to load contribution records");
    } finally {
      setLoading(false);
    }
  }, [page, query, eventFilter, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(
    () =>
      subscribeToTables(
        ["contributions", "students", "events", "payments"],
        () => !importingRef.current && loadData(),
        "contribution-management",
      ),
    [loadData],
  );

  // Debounce server-side search.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  /** Generates and uploads an official receipt (throws on failure). */
  const issueReceipt = async (student: Student, event: Event, amount: number, imported = false) =>
    autoCreateReceipt({
      tag: "PAYMENT",
      receiptNumber: await officialReceiptNumber(),
      issuedTo: student.name,
      eventName: event.name,
      description: `Payment for ${event.name}${imported ? " (imported)" : ""}`,
      amount,
      type: "income",
      date: today(),
      recordedBy,
    });

  const createPayment = (student: Student, event: Event, contributionId: string, amount: number, receiptUrl?: string) =>
    paymentsService.create({
      studentId: student.id,
      studentName: student.name,
      eventId: event.id,
      eventName: event.name,
      contributionId,
      amount,
      date: today(),
      recordedBy,
      receiptUrl,
    });

  // ---- Record payment (creates the contribution on first payment) ----------
  const recordPayment = async (student: Student, event: Event, amount: number): Promise<boolean> => {
    try {
      setSaving(true);
      const existing = await contributionsService.getByStudentAndEvent(student.id, event.id);
      // Validate before creating anything so a rejected payment leaves no stray record.
      const balance = (existing?.requiredAmount ?? event.allocationAmount) - (existing?.amountPaid ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error("Payment amount must be greater than zero.");
        return false;
      }
      if (amount > balance) {
        toast.error(`Payment exceeds the remaining balance of ${formatPeso(balance)}.`);
        return false;
      }

      let contribution = existing;
      if (!contribution) {
        try {
          contribution = await contributionsService.create({
            studentId: student.id,
            eventId: event.id,
            eventName: event.name,
            requiredAmount: event.allocationAmount,
            amountPaid: 0,
            remainingBalance: event.allocationAmount,
          });
        } catch (createError) {
          // Someone else created it concurrently (unique student+event constraint) — use theirs.
          contribution = await contributionsService.getByStudentAndEvent(student.id, event.id);
          if (!contribution) throw createError;
        }
      }

      let receipt: string | undefined;
      if (canIssueReceipts) {
        try {
          receipt = await issueReceipt(student, event, amount);
          toast.success("An official receipt was generated and attached automatically.");
        } catch (receiptError) {
          console.warn("Auto receipt generation failed:", receiptError);
        }
      }

      await createPayment(student, event, contribution.id, amount, receipt);
      await contributionsService.update(contribution.id, {
        amountPaid: contribution.amountPaid + amount,
        remainingBalance: Math.max(0, contribution.remainingBalance - amount),
      });
      toast.success("Payment recorded successfully!");
      await loadData();
      return true;
    } catch (error) {
      console.error("Error recording payment:", error);
      toast.error("Failed to record payment");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ---- Edit -----------------------------------------------------------------
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editForm) return;
    const { id, studentId, eventId, requiredAmount, amountPaid } = editForm;
    const student = students.find((s) => s.id === studentId);
    const event = events.find((ev) => ev.id === eventId);
    if (!student || !event) return toast.error("Please select both a student and an event");
    if (requiredAmount <= 0) return toast.error("Required amount must be greater than zero");
    if (amountPaid < 0) return toast.error("Amount paid cannot be negative");

    try {
      setSaving(true);
      // One record per student + event; the table only holds one page, so ask the database.
      const existing = await contributionsService.getByStudentAndEvent(studentId, eventId);
      if (existing && existing.id !== id) {
        return toast.error(`${student.name} already has a contribution record for ${event.name}.`);
      }
      await contributionsService.update(id, {
        studentId,
        eventId,
        eventName: event.name,
        requiredAmount,
        amountPaid,
        remainingBalance: Math.max(0, requiredAmount - amountPaid),
      });
      toast.success("Contribution updated successfully");
      setEditForm(null);
      await loadData();
    } catch (error) {
      console.error("Error saving contribution record:", error);
      toast.error("Failed to save contribution record");
    } finally {
      setSaving(false);
    }
  };

  // ---- Delete ---------------------------------------------------------------
  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      setSaving(true);
      await contributionsService.delete(toDelete.id);
      toast.success(`${toDelete.studentName}'s contribution record has been deleted.`);
      setToDelete(null);
      await loadData();
    } catch (error) {
      console.error("Error deleting contribution:", error);
      toast.error(`Failed to delete ${toDelete.studentName}'s contribution record.`);
    } finally {
      setSaving(false);
    }
  };

  // ---- CSV / Excel import ---------------------------------------------------
  const importRows = async (fileRows: Record<string, string>[]) => {
    if (fileRows.length === 0) return void toast.error("File is empty or invalid");

    const studentById = new Map(students.map((s) => [normalizeStudentId(s.studentId).toLowerCase(), s]));
    const studentByName = new Map(students.map((s) => [s.name.toLowerCase(), s]));
    const eventByName = new Map(events.map((e) => [e.name.toLowerCase(), e]));
    const parsed: { student: Student; event: Event; requiredAmount: number; amountPaid: number }[] = [];
    let skipped = 0;

    for (const row of fileRows) {
      const fileId = pickField(row, "studentid", "studentno", "studentnumber", "studid", "idnumber", "lrn", "id");
      const student =
        studentById.get(normalizeStudentId(fileId).toLowerCase()) ??
        studentByName.get(pickField(row, "name", "fullname", "studentname").toLowerCase());
      // A row may hold several Event / Required / Paid groups.
      const groups = student ? expandEventGroups(row) : [];
      if (!student || groups.length === 0) {
        skipped++;
        continue;
      }
      for (const group of groups) {
        const event = eventByName.get(group.eventName.toLowerCase());
        const requiredAmount = parseAmount(group.requiredAmount);
        const amountPaid = parseAmount(group.amountPaid);
        if (!event || requiredAmount <= 0 || amountPaid < 0 || amountPaid > requiredAmount) {
          if (event) console.warn(`Skipped invalid amount: ${student.studentId} / ${event.name} (required ₱${requiredAmount}, paid ₱${amountPaid})`);
          skipped++;
          continue;
        }
        parsed.push({ student, event, requiredAmount, amountPaid });
      }
    }

    if (parsed.length === 0) return void toast.error(`No valid rows found. ${IMPORT_HINT}`);

    // Dedupe against ALL existing records (not just the visible page) and within the file.
    let existingKeys: Set<string>;
    try {
      existingKeys = new Set((await contributionsService.getAll()).map((r) => pairKey(r.studentId, r.eventId)));
    } catch (error) {
      console.error("Error loading existing contributions for import:", error);
      return void toast.error("Failed to check for existing contribution records");
    }
    const queue = parsed.filter(({ student, event }) => {
      const key = pairKey(student.id, event.id);
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    skipped += parsed.length - queue.length;
    if (queue.length === 0) return void toast.info("All rows in the file already have contribution records");

    importingRef.current = true;
    toast.info(`Importing ${queue.length} contribution(s)...`);
    const count = { imported: 0, failed: 0, receipts: 0, receiptFailed: 0 };

    // Bounded concurrency so a big sheet doesn't fire hundreds of requests at once.
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { student, event, requiredAmount, amountPaid } = item;
        try {
          const contribution = await contributionsService.create({
            studentId: student.id,
            eventId: event.id,
            eventName: event.name,
            requiredAmount,
            amountPaid,
            remainingBalance: Math.max(0, requiredAmount - amountPaid),
          });
          count.imported++;
          // The historical amount is kept on the contribution either way; only
          // receipt-issuing roles also generate a receipt + payment record.
          if (amountPaid > 0 && canIssueReceipts) {
            try {
              await createPayment(student, event, contribution.id, amountPaid, await issueReceipt(student, event, amountPaid, true));
              count.receipts++;
            } catch (receiptError) {
              console.warn("Auto receipt generation failed for an imported row:", receiptError);
              count.receiptFailed++;
            }
          }
        } catch (error) {
          // A concurrent writer created the same student+event pair.
          if (isDuplicateError(error)) skipped++;
          else {
            count.failed++;
            console.error("Error importing a contribution row:", error);
          }
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, queue.length) }, worker));
      toast.success(
        [
          `${count.imported} contribution(s) imported`,
          count.failed && `${count.failed} contribution(s) failed`,
          count.receipts && `${count.receipts} receipt(s) generated`,
          skipped && `${skipped} skipped`,
          count.receiptFailed && `${count.receiptFailed} receipt(s) failed`,
        ]
          .filter(Boolean)
          .join(", "),
      );
    } catch (error) {
      console.error("Error importing contribution records:", error);
      toast.error("Failed to import contribution records");
    } finally {
      importingRef.current = false;
      await loadData();
    }
  };

  const { importing, handleFileSelected, importInputRef } = useSpreadsheetImport({ onRows: importRows });

  const rowStatus = (payment: PaymentRecord) =>
    rows.find(
      (r) => r.id === payment.contributionId || (r.studentId === payment.studentId && r.eventId === payment.eventId),
    );

  return (
    <Page
      eyebrow="Finance"
      title="Contributions & Payments"
      subtitle="Track balances, record payments, and manage each student's contribution to every event."
      onBack={onBack}
      actions={
        <>
          <button
            onClick={() => importInputRef.current?.click()}
            className="btn btn-light"
            disabled={loading || importing}
            title={`Import contribution records from a CSV or Excel (.xlsx) file. ${IMPORT_HINT} A receipt is generated for every imported row with a payment.`}
          >
            <FileUp className="h-4 w-4" />
            {importing ? "Importing…" : "Import CSV / Excel"}
          </button>
          <button onClick={() => setPaymentOpen(true)} className="btn btn-primary" disabled={loading || importing}>
            Record payment
            <span className="btn-orb">
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </>
      }
      hero={
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard featured icon={Wallet} label="Total collected" value={formatPeso(totals.totalPaid)} hint="payments received" />
          <StatCard icon={Coins} label="Total collectable" value={formatPeso(totals.totalRequired)} hint="required contributions" />
          <StatCard icon={Scale} tone="warning" label="Outstanding" value={formatPeso(totals.totalBalance)} hint="remaining balances" />
          <StatCard icon={ListChecks} tone="success" label="Records" value={total.toLocaleString()} hint="matching current filters" />
        </div>
      }
    >
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Recent payments */}
      <section className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="icon-tile">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold text-ink">Recent payments</h2>
            <p className="text-xs text-muted">Latest recorded student payments</p>
          </div>
        </div>
        {payments.length === 0 ? (
          <EmptyState icon={CreditCard} title="No payments recorded yet" />
        ) : (
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {payments.slice(0, 8).map((payment) => {
              const record = rowStatus(payment);
              return (
                <div key={payment.id} className="flex min-w-[230px] shrink-0 flex-col gap-2 rounded-2xl border border-line bg-surface-2 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{payment.studentName}</p>
                      <p className="truncate text-xs text-muted">{payment.eventName}</p>
                    </div>
                    <p className="shrink-0 font-bold text-success">{formatPeso(payment.amount)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>{formatDate(payment.date)}</span>
                    {record && <StatusChip record={record} />}
                    {payment.receiptUrl && (
                      <button className="btn btn-ghost btn-sm -my-1 -mr-2 px-2" onClick={() => setReceiptUrl(payment.receiptUrl!)}>
                        <Receipt className="h-3.5 w-3.5" />
                        Receipt
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by student name or ID…" className="flex-1" />
        <select
          value={eventFilter}
          onChange={(e) => {
            setEventFilter(e.target.value);
            setPage(1);
          }}
          className="input sm:w-56"
          aria-label="Filter by event"
        >
          <option value="">All events</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="input sm:w-48"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Records */}
      {loading ? (
        <LoadingCard label="Loading contribution records…" />
      ) : (
        <div className="card overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState icon={Coins} title="No contribution records found" description="Try a different search or filter, or record a payment." />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Event</th>
                    <th className="text-right">Required</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                    <th className="w-12" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <p className="font-semibold">{record.studentName}</p>
                        <p className="text-xs text-muted">{record.studentDisplayId}</p>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-muted">
                          <CalendarDays className="h-4 w-4" />
                          {record.eventName}
                        </span>
                      </td>
                      <td className="text-right tabular-nums text-muted">{formatPeso(record.requiredAmount)}</td>
                      <td className="text-right font-semibold tabular-nums text-success">{formatPeso(record.amountPaid)}</td>
                      <td className="text-right tabular-nums">{formatPeso(record.remainingBalance)}</td>
                      <td>
                        <StatusChip record={record} />
                      </td>
                      <td className="text-right">
                        <Menu>
                          <RowActionsTrigger label={`Actions for ${record.studentName}`} />
                          <MenuContent>
                            <MenuItem
                              onSelect={() =>
                                setEditForm({
                                  id: record.id,
                                  studentId: record.studentId,
                                  eventId: record.eventId,
                                  requiredAmount: record.requiredAmount,
                                  amountPaid: record.amountPaid,
                                })
                              }
                            >
                              <Pencil />
                              Edit
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem danger onSelect={() => setToDelete(record)}>
                              <Trash2 />
                              Delete
                            </MenuItem>
                          </MenuContent>
                        </Menu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        </div>
      )}

      {editForm && (
        <EditContributionModal
          form={editForm}
          onChange={setEditForm}
          onSubmit={saveEdit}
          onClose={() => !saving && setEditForm(null)}
          students={students}
          events={events}
          saving={saving}
        />
      )}

      {paymentOpen && (
        <RecordPaymentModal
          students={students}
          events={events}
          saving={saving}
          onClose={() => !saving && setPaymentOpen(false)}
          onSubmit={async (student, event, amount) => (await recordPayment(student, event, amount)) && setPaymentOpen(false)}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={saving}
        title="Delete contribution"
        description={`Delete ${toDelete?.studentName ?? "this student"}'s contribution record for ${toDelete?.eventName ?? "this event"}? This cannot be undone.`}
        confirmLabel="Delete contribution"
      />

      <ReceiptViewer receiptUrl={receiptUrl} onClose={() => setReceiptUrl(null)} title="Payment Receipt" />
    </Page>
  );
}

// ---------------------------------------------------------------------------

interface EditContributionModalProps {
  form: EditForm;
  onChange: (form: EditForm) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
  students: Student[];
  events: Event[];
  saving: boolean;
}

function EditContributionModal({ form, onChange, onSubmit, onClose, students, events, saving }: EditContributionModalProps) {
  const set = (patch: Partial<EditForm>) => onChange({ ...form, ...patch });
  const balance = Math.max(0, form.requiredAmount - form.amountPaid);

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit contribution"
      icon={<Pencil className="h-5 w-5" />}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="edit-contribution"
            className="btn btn-primary"
            disabled={saving || !form.studentId || !form.eventId || form.requiredAmount <= 0}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="edit-contribution" onSubmit={onSubmit} className="space-y-4">
        <Field label="Student">
          <select value={form.studentId} onChange={(e) => set({ studentId: e.target.value })} className="input" disabled={saving}>
            <option value="">Select student…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.studentId} – {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Event">
          <select value={form.eventId} onChange={(e) => set({ eventId: e.target.value })} className="input" disabled={saving}>
            <option value="">Select event…</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Required amount (₱)">
            <AmountInput value={form.requiredAmount} onChange={(requiredAmount) => set({ requiredAmount })} disabled={saving} />
          </Field>
          <Field label="Amount paid (₱)">
            <AmountInput value={form.amountPaid} onChange={(amountPaid) => set({ amountPaid })} disabled={saving} />
          </Field>
        </div>
        <SummaryLine label="Remaining balance">
          <span className={cn("font-bold", balance > 0 ? "text-danger" : "text-success")}>{formatPeso(balance)}</span>
        </SummaryLine>
      </form>
    </Modal>
  );
}

interface RecordPaymentModalProps {
  students: Student[];
  events: Event[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (student: Student, event: Event, amount: number) => void;
}

function RecordPaymentModal({ students, events, saving, onClose, onSubmit }: RecordPaymentModalProps) {
  const [student, setStudent] = useState<Student | null>(null);
  const [studentQuery, setStudentQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [eventId, setEventId] = useState("");
  const [amount, setAmount] = useState(0);
  // The selected pair's existing record (may live on any table page, so it is fetched).
  const [existing, setExisting] = useState<ContributionRecord | null>(null);
  const lookupRef = useRef(0);

  const event = events.find((ev) => ev.id === eventId);
  const needle = studentQuery.trim().toLowerCase();
  const matches =
    pickerOpen && needle && !student
      ? students.filter((s) => s.name.toLowerCase().includes(needle) || s.studentId.toLowerCase().includes(needle)).slice(0, 8)
      : [];

  const lookup = (nextStudent: Student | null, nextEventId: string) => {
    const id = ++lookupRef.current;
    setExisting(null);
    if (!nextStudent || !nextEventId) return;
    contributionsService
      .getByStudentAndEvent(nextStudent.id, nextEventId)
      .then((record) => id === lookupRef.current && setExisting(record))
      .catch((error) => console.warn("Contribution lookup failed:", error));
  };

  const required = existing?.requiredAmount ?? event?.allocationAmount;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!student || !event) return void toast.error("Please select both student and event");
    onSubmit(student, event, amount);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record payment"
      description="A contribution record is created automatically on a student's first payment."
      icon={<CreditCard className="h-5 w-5" />}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="record-payment" className="btn btn-primary" disabled={saving || !student || !eventId || amount <= 0}>
            {saving ? "Recording…" : "Record payment"}
          </button>
        </>
      }
    >
      <form id="record-payment" onSubmit={submit} className="space-y-4">
        <div className="relative">
          <Field label="Student">
            <input
              value={studentQuery}
              onChange={(e) => {
                setStudentQuery(e.target.value);
                setStudent(null);
                setPickerOpen(true);
                lookup(null, eventId);
              }}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setPickerOpen(false)}
              placeholder="Search by name or student ID…"
              className="input"
              disabled={saving}
              autoComplete="off"
            />
          </Field>
          {matches.length > 0 && (
            <ul className="card absolute z-10 mt-1 max-h-56 w-full overflow-y-auto p-1.5 shadow-lift">
              {matches.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    // mousedown fires before the input's blur closes the list
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setStudent(s);
                      setStudentQuery(`${s.name} (${s.studentId})`);
                      setPickerOpen(false);
                      lookup(s, eventId);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    <span className="truncate font-medium text-ink">{s.name}</span>
                    <span className="shrink-0 text-xs text-muted">{s.studentId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Field label="Event">
          <select
            value={eventId}
            onChange={(e) => {
              setEventId(e.target.value);
              lookup(student, e.target.value);
            }}
            className="input"
            disabled={saving}
          >
            <option value="">Select event…</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (₱)">
          <AmountInput value={amount} onChange={setAmount} disabled={saving} />
        </Field>

        {student && event && required !== undefined && (
          <div className="space-y-2 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm">
            <SummaryLine label="Required">{formatPeso(required)}</SummaryLine>
            {existing && <SummaryLine label="Already paid">{formatPeso(existing.amountPaid)}</SummaryLine>}
            <SummaryLine label="Status">
              <StatusChip record={existing ?? { amountPaid: 0, remainingBalance: required }} />
            </SummaryLine>
          </div>
        )}
      </form>
    </Modal>
  );
}

function AmountInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <input
      type="number"
      min={0}
      step={0.01}
      inputMode="decimal"
      value={value || ""}
      onChange={(e) => onChange(Number(e.target.value))}
      placeholder="0.00"
      className="input tabular-nums"
      disabled={disabled}
    />
  );
}

function SummaryLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{children}</span>
    </div>
  );
}
