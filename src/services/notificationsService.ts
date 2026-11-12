import { getSupabase } from "../lib/supabase";

type NotificationType = "payment" | "file" | "deadline" | "announcement";
type RecipientKind = "officer" | "all_officers" | "student" | "all_students";

export interface AppNotification {
  id: string;
  recipientKind: RecipientKind;
  recipientUserId: string | null;
  recipientStudentId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  recipient_kind: RecipientKind;
  recipient_user_id: string | null;
  recipient_student_id: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

const sb = () => getSupabase();
const now = () => new Date().toISOString();

const fromRow = (row: NotificationRow): AppNotification => ({
  id: row.id,
  recipientKind: row.recipient_kind,
  recipientUserId: row.recipient_user_id,
  recipientStudentId: row.recipient_student_id,
  type: row.type,
  title: row.title,
  body: row.body,
  link: row.link,
  readAt: row.read_at,
  createdAt: row.created_at,
});

async function run(query: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await query;
  if (error) throw error;
}

async function list(
  query: PromiseLike<{ data: NotificationRow[] | null; error: unknown }>,
): Promise<AppNotification[]> {
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

const notifications = (limit: number) =>
  sb().from("notifications").select("*").order("created_at", { ascending: false }).limit(limit);

/** Realtime INSERTs on notifications, optionally filtered client-side. Returns an unsubscribe. */
function subscribeInserts(
  scope: string,
  onInsert: (n: AppNotification) => void,
  relevant: (row: NotificationRow) => boolean = () => true,
): () => void {
  const client = sb();
  const channel = client.channel(`notifications-${scope}-${crypto.randomUUID()}`);
  channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
    const row = payload.new as NotificationRow;
    if (relevant(row)) onInsert(fromRow(row));
  });
  channel.subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

const isForStudent = (row: NotificationRow, studentId: string) =>
  row.recipient_kind === "all_students" ||
  (row.recipient_kind === "student" && row.recipient_student_id === studentId);

interface PushKeys {
  endpoint: string;
  p256dh: string;
  authKey: string;
}

// Delete-then-insert rather than upsert: the endpoint may belong to a row of
// another subscriber kind (same browser, earlier identity) and there is no
// UPDATE policy; deleting by endpoint is only possible for its owning browser.
async function savePushSubscription(
  keys: PushKeys,
  subscriber: { subscriber_kind: "officer" | "student" | "anonymous"; officer_user_id?: string; student_id?: string },
): Promise<void> {
  await sb().from("push_subscriptions").delete().eq("endpoint", keys.endpoint);
  await run(
    sb()
      .from("push_subscriptions")
      .insert({
        id: crypto.randomUUID(),
        ...subscriber,
        endpoint: keys.endpoint,
        p256dh: keys.p256dh,
        auth_key: keys.authKey,
        created_at: now(),
      }),
  );
}

export const notificationsService = {
  // Officer side: RLS limits rows to the officer's own + all_officers broadcasts.
  getForOfficer: (limit = 50) => list(notifications(limit)),
  subscribeOfficer: (onInsert: (n: AppNotification) => void) => subscribeInserts("officer", onInsert),
  markAsRead: (id: string) => run(sb().from("notifications").update({ read_at: now() }).eq("id", id)),
  markAllReadForOfficer: () => run(sb().from("notifications").update({ read_at: now() }).is("read_at", null)),

  // Student side: no login, so rows are filtered by the open student record
  // and read state is not persisted.
  getForStudent: (studentId: string, limit = 20) =>
    list(
      notifications(limit).or(
        `recipient_kind.eq.all_students,and(recipient_kind.eq.student,recipient_student_id.eq.${studentId})`,
      ),
    ),
  subscribeStudent: (studentId: string, onInsert: (n: AppNotification) => void) =>
    subscribeInserts("student", onInsert, (row) => isForStudent(row, studentId)),

  // Any visitor: broadcasts only, never a specific student's rows.
  getPublicBroadcasts: (limit = 20) => list(notifications(limit).eq("recipient_kind", "all_students")),
  subscribePublicBroadcasts: (onInsert: (n: AppNotification) => void) =>
    subscribeInserts("public", onInsert, (row) => row.recipient_kind === "all_students"),

  /** Staff only — enforced by the INSERT policy (public.is_staff()). */
  sendAnnouncement: (input: {
    recipientKind: Extract<RecipientKind, "all_students" | "all_officers" | "student">;
    /** Required when recipientKind === "student" (the internal students.id). */
    recipientStudentId?: string;
    title: string;
    body: string;
  }) =>
    run(
      sb()
        .from("notifications")
        .insert({
          id: crypto.randomUUID(),
          recipient_kind: input.recipientKind,
          recipient_student_id: input.recipientKind === "student" ? (input.recipientStudentId ?? null) : null,
          type: "announcement",
          title: input.title,
          body: input.body,
          link: null,
          created_at: now(),
        }),
    ),

  deleteNotification: (id: string) => run(sb().from("notifications").delete().eq("id", id)),

  async subscribeOfficerPush(keys: PushKeys): Promise<void> {
    const { data, error } = await sb().auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error("Must be signed in to subscribe to push notifications.");
    await savePushSubscription(keys, { subscriber_kind: "officer", officer_user_id: data.user.id });
  },
  subscribeStudentPush: (studentId: string, keys: PushKeys) =>
    savePushSubscription(keys, { subscriber_kind: "student", student_id: studentId }),
  subscribeAnonymousPush: (keys: PushKeys) => savePushSubscription(keys, { subscriber_kind: "anonymous" }),
  unsubscribePush: (endpoint: string) => run(sb().from("push_subscriptions").delete().eq("endpoint", endpoint)),
};
