import { getSupabase } from "../lib/supabase";
import { offlineSyncService } from "../lib/offlineSync";
import { normalizeStudentName, splitSearchWords, escapeLikePattern } from "../lib/utils";
import type {
  Student,
  Event,
  EventSchedule,
  AttendanceRecord,
  ContributionRecord,
  PaymentRecord,
  Transaction,
  FeedbackItem,
  FinancialReport,
  StudentRequirementFile,
} from "../types";

type Table = Parameters<typeof offlineSyncService.read>[0];
type Row = Record<string, unknown>;

const sb = () => getSupabase();
// TEXT primary keys (legacy Firestore ids): Postgres never generates them.
const newId = (): string => crypto.randomUUID();
const PAGE_SIZE = 1000;
const REQUIREMENTS_BUCKET = "student-requirements";

async function unwrap<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";

// PostgREST silently caps unranged selects at the project's "Max Rows"
// setting, so full-table reads page through with .range() until a short page.
async function fetchAllRows(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = (await unwrap(fetchPage(from, from + PAGE_SIZE - 1))) ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// Online-first full-table read that refreshes the offline cache, falling back
// to that cache when offline or when the request fails.
async function cachedRead<T>(table: Table, fetcher: () => Promise<T[]>): Promise<T[]> {
  if (offlineSyncService.isOffline()) {
    const cached = await offlineSyncService.read<T>(table);
    if (cached) return cached;
  }
  try {
    const records = await fetcher();
    await offlineSyncService.cache(table, records);
    return records;
  } catch (error) {
    const cached = await offlineSyncService.read<T>(table);
    if (cached) return cached;
    throw error;
  }
}

// Filtered read: never writes the table cache (a subset would overwrite the
// full table), but falls back to filtering the cached full table.
async function cachedQuery<T>(
  table: Table,
  fetcher: () => Promise<T[]>,
  fallbackFilter: (record: T) => boolean,
): Promise<T[]> {
  const fromCache = async () => (await offlineSyncService.read<T>(table))?.filter(fallbackFilter);
  if (offlineSyncService.isOffline()) {
    const cached = await fromCache();
    if (cached) return cached;
  }
  try {
    return await fetcher();
  } catch (error) {
    const cached = await fromCache();
    if (cached) return cached;
    throw error;
  }
}

// Session-lifetime memo for the small reference tables every section loads
// (students, events). Stores the in-flight promise so concurrent mounts share
// one request; writes and realtime changes invalidate it.
const memo = new Map<Table, Promise<unknown[]>>();

// ============================================
// GENERIC TABLE HELPER
// ============================================
interface TableSpec<T extends { id: string }> {
  name: Table;
  /** camelCase field -> snake_case column. */
  columns: { [K in Exclude<keyof T, "id">]-?: string };
  /** Fields whose null/"" column value maps to undefined. */
  optional?: (keyof T)[];
  /** Extra per-row fixes beyond a plain rename. */
  fix?: (record: T, row: Row) => T;
  order: { column: string; ascending: boolean };
  memoize?: boolean;
  duplicateMessage?: string;
}

function defineTable<T extends { id: string }>(spec: TableSpec<T>) {
  const { name, columns, order } = spec;
  const entries = Object.entries(columns) as [keyof T & string, string][];

  const fromRow = (row: Row): T => {
    const record: Row = { id: row.id };
    for (const [key, column] of entries) {
      const value = row[column];
      record[key] = spec.optional?.includes(key) && (value == null || value === "") ? undefined : value;
    }
    return spec.fix ? spec.fix(record as T, row) : (record as T);
  };

  const toRow = (record: Partial<T>): Row => {
    const row: Row = {};
    for (const [key, column] of entries) if (record[key] !== undefined) row[column] = record[key];
    return row;
  };

  const invalidate = () => {
    if (spec.memoize) memo.delete(name);
  };

  const fetchAll = async (): Promise<T[]> => {
    const rows = await fetchAllRows((from, to) => {
      let query = sb().from(name).select("*").order(order.column, { ascending: order.ascending });
      // Unique tie-breaker so range() pages never skip/duplicate rows.
      if (order.column !== "id") query = query.order("id");
      return query.range(from, to);
    });
    return rows.map(fromRow);
  };

  const singleRow = async (query: PromiseLike<{ data: Row | null; error: unknown }>): Promise<T> => {
    try {
      return fromRow((await unwrap(query)) as Row);
    } catch (error) {
      if (spec.duplicateMessage && isUniqueViolation(error)) throw new Error(spec.duplicateMessage);
      throw error;
    }
  };

  const ensure = (result: T | undefined, action: string): T => {
    if (!result) throw new Error(`Failed to ${action} ${name} record`);
    return result;
  };

  return {
    fromRow,
    toRow,
    invalidate,

    getAll(): Promise<T[]> {
      if (!spec.memoize) return cachedRead(name, fetchAll);
      let pending = memo.get(name) as Promise<T[]> | undefined;
      if (!pending) {
        const request = cachedRead(name, fetchAll);
        pending = request;
        memo.set(name, request);
        request.catch(() => {
          if (memo.get(name) === request) memo.delete(name);
        });
      }
      return pending;
    },

    async list(query: PromiseLike<{ data: Row[] | null; error: unknown }>): Promise<T[]> {
      return ((await unwrap(query)) ?? []).map(fromRow);
    },

    async create(record: Omit<T, "id">): Promise<T> {
      const id = newId();
      const payload = toRow(record as Partial<T>);
      const result = await offlineSyncService.mutation<T>({
        table: name,
        kind: "create",
        recordId: id,
        payload,
        makeLocal: () => ({ ...record, id }) as T,
        executeOnline: () => singleRow(sb().from(name).insert({ id, ...payload }).select().single()),
      });
      invalidate();
      return ensure(result, "create");
    },

    async update(id: string, patch: Partial<T>): Promise<T> {
      const payload = toRow(patch);
      const result = await offlineSyncService.mutation<T>({
        table: name,
        kind: "update",
        recordId: id,
        payload,
        makeLocal: (current) => ({ ...(current as T), ...patch, id }),
        executeOnline: () => singleRow(sb().from(name).update(payload).eq("id", id).select().single()),
      });
      invalidate();
      return ensure(result, "update");
    },

    async delete(id: string): Promise<void> {
      await offlineSyncService.mutation<void>({
        table: name,
        kind: "delete",
        recordId: id,
        payload: {},
        executeOnline: () => unwrap(sb().from(name).delete().eq("id", id)).then(() => undefined),
      });
      invalidate();
    },
  };
}

const byDateDesc = <T extends { date: string }>(a: T, b: T) =>
  new Date(b.date).getTime() - new Date(a.date).getTime();

/** Students whose name contains every typed word (any order) or whose ID contains the query. */
async function findStudentRows(query: string): Promise<Row[]> {
  let byName = sb().from("students").select("*").order("name");
  for (const word of splitSearchWords(query).map(escapeLikePattern)) {
    byName = byName.ilike("name", `%${word}%`);
  }
  const byId = sb()
    .from("students")
    .select("*")
    .ilike("student_id", `%${escapeLikePattern(query.trim())}%`)
    .order("name");
  const [names, ids] = await Promise.all([unwrap(byName), unwrap(byId)]);
  return [...new Map([...(names ?? []), ...(ids ?? [])].map((row: Row) => [row.id, row])).values()];
}

// ============================================
// STUDENTS
// ============================================
const students = defineTable<Student>({
  name: "students",
  columns: { studentId: "student_id", name: "name", program: "program", yearLevel: "year_level", section: "section" },
  order: { column: "name", ascending: true },
  memoize: true,
});

const withNormalizedName = <T extends Partial<Student>>(record: T): T =>
  record.name === undefined ? record : { ...record, name: normalizeStudentName(record.name) };

export const studentsService = {
  getAll: students.getAll,

  async getByStudentId(studentId: string): Promise<Student | null> {
    return (await students.getAll()).find((s) => s.studentId === studentId) ?? null;
  },

  create: (student: Omit<Student, "id">) => students.create(withNormalizedName(student)),
  update: (id: string, record: Partial<Student>) => students.update(id, withNormalizedName(record)),
  delete: students.delete,

  // Imports run in small parallel batches; per-row failures (e.g. duplicates)
  // are reported instead of aborting the batch.
  async createMany(list: Omit<Student, "id">[]): Promise<{
    created: Student[];
    failed: { index: number; studentId: string; name: string; error: string }[];
  }> {
    const created: Student[] = [];
    const failed: { index: number; studentId: string; name: string; error: string }[] = [];
    const BATCH = 10;
    for (let start = 0; start < list.length; start += BATCH) {
      const batch = list.slice(start, start + BATCH);
      const results = await Promise.allSettled(batch.map((s) => studentsService.create(s)));
      results.forEach((result, offset) => {
        if (result.status === "fulfilled") return void created.push(result.value);
        const { studentId, name } = batch[offset];
        const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failed.push({ index: start + offset, studentId, name, error });
      });
    }
    return { created, failed };
  },

  async search(query: string): Promise<Student[]> {
    return (await findStudentRows(query)).map(students.fromRow);
  },
};

// ============================================
// EVENTS
// ============================================
function parseSchedules(value: unknown): EventSchedule[] {
  if (Array.isArray(value)) return value as EventSchedule[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const events = defineTable<Event>({
  name: "events",
  columns: {
    name: "name",
    allocationAmount: "allocation_amount",
    date: "date",
    contributionDeadline: "contribution_deadline",
    evaluationActive: "evaluation_active",
    evaluationFormUrl: "evaluation_form_url",
    schedules: "schedules",
  },
  optional: ["contributionDeadline", "evaluationFormUrl"],
  fix: (event, row) => ({
    ...event,
    date: event.date ?? undefined,
    evaluationActive: Boolean(event.evaluationActive),
    schedules: parseSchedules(row.schedules),
  }),
  order: { column: "date", ascending: false },
  memoize: true,
});

export const eventsService = {
  getAll: events.getAll,
  create: (event: Omit<Event, "id">) =>
    events.create({
      ...event,
      contributionDeadline: event.contributionDeadline ?? "",
      evaluationActive: event.evaluationActive ?? false,
      evaluationFormUrl: event.evaluationFormUrl ?? "",
      schedules: event.schedules ?? [],
    }),
  update: events.update,
  delete: events.delete,
};

// ============================================
// EVENT EVALUATIONS (rows written by the Apps Script sync; read-only here)
// ============================================
export const eventEvaluationsService = {
  /** The most recent evaluation-active event this student hasn't submitted for, or null. */
  async getPendingGate(studentId: string): Promise<Event | null> {
    const activeEvent = (await events.getAll()).find((event) => event.evaluationActive);
    if (!activeEvent) return null;
    // limit(1), not maybeSingle(): a duplicate submission must not throw.
    const rows = await unwrap(
      sb()
        .from("event_evaluations")
        .select("id")
        .eq("event_id", activeEvent.id)
        .eq("student_id", studentId.trim().toLowerCase())
        .limit(1),
    );
    return rows && rows.length > 0 ? null : activeEvent;
  },
};

// ============================================
// ATTENDANCE
// ============================================
const attendance = defineTable<AttendanceRecord>({
  name: "attendance",
  columns: {
    studentId: "student_id",
    eventId: "event_id",
    eventName: "event_name",
    date: "date",
    status: "status",
    session: "session",
    timeIn: "time_in",
    timeOut: "time_out",
  },
  optional: ["timeIn", "timeOut"],
  fix: (record) => ({ ...record, session: record.session ?? "morning" }),
  order: { column: "date", ascending: false },
});

const attendanceQuery = (filter: (record: AttendanceRecord) => boolean, build: () => PromiseLike<{ data: Row[] | null; error: unknown }>) =>
  cachedQuery("attendance", () => attendance.list(build()), filter).then((records) => records.sort(byDateDesc));

export const attendanceService = {
  getAll: attendance.getAll,

  getByStudentId: (studentId: string) =>
    attendanceQuery(
      (r) => r.studentId === studentId,
      () => sb().from("attendance").select("*").eq("student_id", studentId).order("date", { ascending: false }),
    ),

  getByEventIdAndSession: (eventId: string, session: AttendanceRecord["session"]) =>
    attendanceQuery(
      (r) => r.eventId === eventId && r.session === session,
      () =>
        sb()
          .from("attendance")
          .select("*")
          .eq("event_id", eventId)
          .eq("session", session)
          .order("date", { ascending: false }),
    ),

  create: (record: Omit<AttendanceRecord, "id">) =>
    attendance.create({
      ...record,
      session: record.session ?? "morning",
      timeIn: record.timeIn ?? "",
      timeOut: record.timeOut ?? "",
    }),
  update: attendance.update,
  delete: attendance.delete,
};

// ============================================
// CONTRIBUTIONS
// ============================================
const contributions = defineTable<ContributionRecord>({
  name: "contributions",
  columns: {
    studentId: "student_id",
    eventId: "event_id",
    eventName: "event_name",
    requiredAmount: "required_amount",
    amountPaid: "amount_paid",
    remainingBalance: "remaining_balance",
  },
  order: { column: "id", ascending: false },
  // UNIQUE (student_id, event_id) is the authoritative double-entry guard.
  duplicateMessage: "This student already has a contribution record for this event.",
});

export const contributionsService = {
  /** Every contribution (imports/offline). Paginated screens use getPage(). */
  getAll: contributions.getAll,

  /** One zero-based page, filtered server-side by search (event name, student name/ID), event and status. */
  async getPage(
    page: number,
    pageSize: number,
    searchTerm = "",
    eventId = "",
    status = "",
  ): Promise<{ data: ContributionRecord[]; total: number }> {
    const search = searchTerm.trim();
    let query = sb().from("contributions").select("*", { count: "exact" }).order("id", { ascending: false });

    if (eventId) query = query.eq("event_id", eventId);

    if (search) {
      const studentIds = (await findStudentRows(search)).map((row) => row.id as string);
      const pattern = `%${escapeLikePattern(search).replace(/[,()]/g, "\\$&")}%`;
      query = studentIds.length
        ? query.or(`event_name.ilike.${pattern},student_id.in.(${studentIds.join(",")})`)
        : query.ilike("event_name", pattern);
    }

    if (status === "unpaid") query = query.eq("amount_paid", 0);
    else if (status === "partial") query = query.gt("amount_paid", 0).gt("remaining_balance", 0);
    else if (status === "paid") query = query.lte("remaining_balance", 0);

    const from = page * pageSize;
    const { data, error, count } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    return { data: (data ?? []).map(contributions.fromRow), total: count ?? 0 };
  },

  /** Summary-card totals computed in Postgres. */
  async getTotals(): Promise<{ totalRequired: number; totalPaid: number; totalBalance: number }> {
    const data = await unwrap(sb().rpc("get_contribution_totals"));
    const row = Array.isArray(data) ? data[0] : data;
    return {
      totalRequired: Number(row?.total_required ?? 0),
      totalPaid: Number(row?.total_paid ?? 0),
      totalBalance: Number(row?.total_balance ?? 0),
    };
  },

  /** eventId -> amount collected, computed in Postgres. */
  async getTotalsByEvent(): Promise<Record<string, number>> {
    const data = await unwrap(sb().rpc("get_event_contribution_totals"));
    const rows: Row[] = Array.isArray(data) ? data : [];
    return Object.fromEntries(rows.map((row) => [row.event_id as string, Number(row.collected ?? 0)]));
  },

  getByStudentId: (studentId: string) =>
    contributions.list(
      sb().from("contributions").select("*").eq("student_id", studentId).order("id", { ascending: false }),
    ),

  async getByStudentAndEvent(studentId: string, eventId: string): Promise<ContributionRecord | null> {
    const row = await unwrap(
      sb().from("contributions").select("*").eq("student_id", studentId).eq("event_id", eventId).maybeSingle(),
    );
    return row ? contributions.fromRow(row) : null;
  },

  create: contributions.create,
  update: contributions.update,
  delete: contributions.delete,
};

// ============================================
// PAYMENTS
// ============================================
const payments = defineTable<PaymentRecord>({
  name: "payments",
  columns: {
    studentId: "student_id",
    studentName: "student_name",
    eventId: "event_id",
    eventName: "event_name",
    contributionId: "contribution_id",
    amount: "amount",
    date: "date",
    receiptUrl: "receipt_url",
    orNumber: "or_number",
    recordedBy: "recorded_by",
  },
  optional: ["receiptUrl", "orNumber"],
  fix: (payment) => ({ ...payment, contributionId: payment.contributionId ?? "" }),
  order: { column: "date", ascending: false },
});

export const paymentsService = {
  getAll: payments.getAll,
  getByStudentId: (studentId: string) =>
    payments.list(sb().from("payments").select("*").eq("student_id", studentId).order("date", { ascending: false })),
  create: payments.create,
};

// ============================================
// TRANSACTIONS
// ============================================
const transactions = defineTable<Transaction>({
  name: "transactions",
  columns: {
    date: "date",
    description: "description",
    eventId: "event_id",
    eventName: "event_name",
    amount: "amount",
    type: "type",
    responsibleOfficer: "responsible_officer",
    receiptUrl: "receipt_url",
  },
  optional: ["eventId", "eventName", "receiptUrl"],
  order: { column: "date", ascending: false },
});

export const transactionsService = {
  getAll: transactions.getAll,
  create: transactions.create,
  update: transactions.update,
  delete: transactions.delete,
};

// ============================================
// FEEDBACK
// ============================================
const feedback = defineTable<FeedbackItem>({
  name: "feedback",
  columns: {
    type: "type",
    title: "title",
    message: "message",
    studentName: "student_name",
    studentId: "student_id",
    isAnonymous: "is_anonymous",
    submittedAt: "submitted_at",
    status: "status",
  },
  optional: ["title", "studentName", "studentId"],
  order: { column: "submitted_at", ascending: false },
});

export const feedbackService = {
  getAll: feedback.getAll,

  async getByStatus(status: FeedbackItem["status"]): Promise<FeedbackItem[]> {
    return (await feedback.getAll()).filter((item) => item.status === status);
  },

  // Students submit anonymously and RLS gives them INSERT but not SELECT,
  // so this inserts without reading the row back.
  async create(item: Omit<FeedbackItem, "id" | "submittedAt">): Promise<void> {
    const id = newId();
    const payload = {
      type: item.type,
      title: item.title || null,
      message: item.message,
      student_name: item.studentName || null,
      student_id: item.studentId || null,
      is_anonymous: item.isAnonymous,
      submitted_at: new Date().toISOString(),
      status: item.status ?? "pending",
    };
    await offlineSyncService.mutation<void>({
      table: "feedback",
      kind: "create",
      recordId: id,
      payload,
      executeOnline: () => unwrap(sb().from("feedback").insert({ id, ...payload })).then(() => undefined),
    });
  },

  async updateStatus(id: string, status: FeedbackItem["status"]): Promise<void> {
    await feedback.update(id, { status });
  },

  delete: feedback.delete,
};

// ============================================
// REALTIME + FINANCIAL REPORT
// ============================================
/** Calls onChange whenever a row in any of `tables` changes; returns an unsubscribe. */
export const subscribeToTables = (
  tables: readonly string[],
  onChange: () => void,
  channelPrefix = "db-live",
): (() => void) => {
  const client = sb();
  const channel = client.channel(`${channelPrefix}-${crypto.randomUUID()}`);
  for (const table of tables) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
      memo.delete(table as Table);
      onChange();
    });
  }
  channel.subscribe();
  return () => {
    void client.removeChannel(channel);
  };
};

export const financialReportingService = {
  async getReport(): Promise<FinancialReport> {
    const data = await unwrap(sb().rpc("get_financial_report"));
    return (
      (data as FinancialReport | null) ?? {
        summary: {
          totalBudget: 0,
          totalFundsCollected: 0,
          totalFundsSpent: 0,
          remainingBudget: 0,
          totalExpectedContributions: 0,
        },
        eventAllocations: [],
      }
    );
  },

  subscribe: (onChange: () => void) =>
    subscribeToTables(
      ["events", "students", "contributions", "payments", "transactions"],
      onChange,
      "financial-report",
    ),
};

// ============================================
// STUDENT REQUIREMENT FILES
// ============================================
const files = defineTable<StudentRequirementFile>({
  name: "student_requirement_files",
  columns: {
    title: "title",
    description: "description",
    fileUrl: "file_url",
    fileName: "file_name",
    fileSize: "file_size",
    fileType: "file_type",
    isPublished: "is_published",
    restricted: "restricted",
    createdBy: "created_by",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  optional: ["description", "fileType", "fileSize"],
  fix: (file) => ({ ...file, isPublished: Boolean(file.isPublished), restricted: Boolean(file.restricted) }),
  order: { column: "created_at", ascending: false },
});

const storagePath = (fileName: string) =>
  `requirements/${crypto.randomUUID()}.${fileName.split(".").pop()?.toLowerCase() || "pdf"}`;

async function uploadRequirement(path: string, blob: Blob): Promise<string> {
  const storage = sb().storage.from(REQUIREMENTS_BUCKET);
  const { error } = await storage.upload(path, blob, { upsert: false, contentType: blob.type });
  if (error) throw new Error(error.message);
  return storage.getPublicUrl(path).data.publicUrl;
}

// Best effort: a leftover object in Storage must never fail the user's action.
async function removeStoredRequirement(fileUrl: unknown): Promise<void> {
  const name = typeof fileUrl === "string" ? fileUrl.split("/requirements/")[1] : undefined;
  if (!name) return;
  try {
    await sb().storage.from(REQUIREMENTS_BUCKET).remove([`requirements/${name}`]);
  } catch (error) {
    console.warn("Could not remove requirement file from storage:", error);
  }
}

const ACCESS_TABLE = "student_requirement_file_access";

export const studentRequirementFilesService = {
  getAll: files.getAll,

  /** Published files this student may see (open + restricted-with-access), resolved server-side. */
  getVisibleForStudent: (studentId: string) =>
    cachedQuery<StudentRequirementFile>(
      "student_requirement_files",
      async () => ((await unwrap(sb().rpc("get_student_requirement_files", { p_student_id: studentId }))) ?? []).map(files.fromRow),
      // Offline we can't check access lists, so only show open published files.
      (file) => file.isPublished && !file.restricted,
    ),

  async getAccessList(fileId: string): Promise<string[]> {
    const rows = await unwrap(sb().from(ACCESS_TABLE).select("student_id").eq("file_id", fileId));
    return (rows ?? []).map((row) => row.student_id as string);
  },

  /** Replaces a restricted file's access list (online only; diffed so only changes hit the DB). */
  async setAccessList(fileId: string, studentIds: string[]): Promise<void> {
    const current = await studentRequirementFilesService.getAccessList(fileId);
    const toRemove = current.filter((id) => !studentIds.includes(id));
    const toAdd = [...new Set(studentIds)].filter((id) => !current.includes(id));
    if (toRemove.length) {
      await unwrap(sb().from(ACCESS_TABLE).delete().eq("file_id", fileId).in("student_id", toRemove));
    }
    if (toAdd.length) {
      const now = new Date().toISOString();
      await unwrap(
        sb()
          .from(ACCESS_TABLE)
          .insert(toAdd.map((studentId) => ({ file_id: fileId, student_id: studentId, created_at: now }))),
      );
    }
  },

  async create(input: {
    title: string;
    description?: string;
    file: Blob;
    fileName: string;
    isPublished?: boolean;
    createdBy: string;
  }): Promise<StudentRequirementFile> {
    // Path is fixed up front so an offline replay uploads to the same place.
    const path = storagePath(input.fileName);
    const id = newId();
    const now = new Date().toISOString();
    const local: StudentRequirementFile = {
      id,
      title: input.title,
      description: input.description,
      fileUrl: "", // stamped after the upload (online or during replay)
      fileName: input.fileName,
      fileSize: input.file.size,
      fileType: input.file.type,
      isPublished: input.isPublished ?? false,
      restricted: false,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const payload: Row = { ...files.toRow(local), description: input.description ?? "", file_url: "" };
    delete payload.restricted;

    const result = await offlineSyncService.mutation<StudentRequirementFile>({
      table: "student_requirement_files",
      kind: "create",
      recordId: id,
      payload,
      fileStorage: { bucket: REQUIREMENTS_BUCKET, path, blob: input.file },
      makeLocal: () => local,
      executeOnline: async () => {
        const fileUrl = await uploadRequirement(path, input.file);
        const row = await unwrap(
          sb().from("student_requirement_files").insert({ ...payload, id, file_url: fileUrl }).select().single(),
        );
        return files.fromRow(row);
      },
    });
    if (!result) throw new Error("Failed to create requirement file");
    return result;
  },

  update: (
    id: string,
    input: { title?: string; description?: string; isPublished?: boolean; restricted?: boolean },
  ) => files.update(id, { ...input, updatedAt: new Date().toISOString() }),

  async replaceFile(id: string, file: Blob, fileName: string): Promise<StudentRequirementFile> {
    const path = storagePath(fileName);
    const updatedAt = new Date().toISOString();
    const patch = { fileName, fileSize: file.size, fileType: file.type, updatedAt };
    const payload = { ...files.toRow(patch), file_url: "" }; // file_url stamped like create()

    const result = await offlineSyncService.mutation<StudentRequirementFile>({
      table: "student_requirement_files",
      kind: "update",
      recordId: id,
      payload,
      fileStorage: { bucket: REQUIREMENTS_BUCKET, path, blob: file },
      makeLocal: (current) => ({ ...(current as StudentRequirementFile), ...patch, id, fileUrl: "" }),
      executeOnline: async () => {
        const current = await unwrap(
          sb().from("student_requirement_files").select("file_url").eq("id", id).single(),
        );
        const fileUrl = await uploadRequirement(path, file);
        const row = await unwrap(
          sb()
            .from("student_requirement_files")
            .update({ ...payload, file_url: fileUrl })
            .eq("id", id)
            .select()
            .single(),
        );
        // Only drop the old object once the row points at the new one.
        await removeStoredRequirement(current?.file_url);
        return files.fromRow(row);
      },
    });
    if (!result) throw new Error("Failed to replace requirement file");
    return result;
  },

  async delete(id: string): Promise<void> {
    await offlineSyncService.mutation<void>({
      table: "student_requirement_files",
      kind: "delete",
      recordId: id,
      payload: {},
      executeOnline: async () => {
        const { data: current } = await sb()
          .from("student_requirement_files")
          .select("file_url")
          .eq("id", id)
          .maybeSingle();
        await unwrap(sb().from("student_requirement_files").delete().eq("id", id));
        await removeStoredRequirement(current?.file_url);
      },
    });
  },
};
