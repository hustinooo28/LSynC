import { getSupabase } from "@/lib/supabase";
import type { UserRole } from "@/types";

export type SyncState = "online" | "offline" | "syncing" | "synced" | "failed";
type TableName =
  | "students"
  | "events"
  | "attendance"
  | "contributions"
  | "payments"
  | "transactions"
  | "feedback"
  | "board_members"
  | "student_requirement_files";
type MutationKind = "create" | "update" | "delete";

/**
 * A file that still needs to be pushed to Supabase Storage before its owning
 * DB mutation (a student_requirement_files create/replace) can be replayed.
 * Stored in its own IndexedDB object store (keyed by the owning mutation's
 * `key`) because Blobs are structured-cloneable but would bloat the mutation
 * records and queries otherwise.
 */
interface PendingUpload {
  key: string;
  ownerId: string;
  bucket: string;
  path: string;
  blob: Blob;
}

interface CachedTable<T = unknown> {
  key: string;
  ownerId: string;
  table: TableName;
  records: T[];
  updatedAt: number;
}

interface QueuedMutation {
  key: string;
  ownerId: string;
  id: string;
  table: TableName;
  kind: MutationKind;
  recordId: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

interface OfflineDatabase extends IDBDatabase {
  transaction(
    storeNames:
      | "tables"
      | "mutations"
      | "uploads"
      | Array<"tables" | "mutations" | "uploads">,
    mode?: IDBTransactionMode,
  ): IDBTransaction;
}

const DB_NAME = "digital-transparency-board-offline";
const DB_VERSION = 2;
const OFFICER_ROLES: readonly UserRole[] = [
  "admin",
  "secretary",
  "treasurer",
  "auditor",
  "board-member",
];

const hasIndexedDb = (): boolean => typeof indexedDB !== "undefined";
const onlineNow = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine;
const cacheKey = (ownerId: string, table: TableName): string =>
  `${ownerId}:${table}`;

const request = <T>(value: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(value.error ?? new Error("IndexedDB request failed"));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });

const openDatabase = (): Promise<OfflineDatabase> =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains("tables"))
        database.createObjectStore("tables", { keyPath: "key" });
      if (!database.objectStoreNames.contains("mutations")) {
        const mutations = database.createObjectStore("mutations", {
          keyPath: "key",
        });
        mutations.createIndex("by_owner_created", ["ownerId", "createdAt"]);
      }
      if (!database.objectStoreNames.contains("uploads"))
        database.createObjectStore("uploads", { keyPath: "key" });
    };
    open.onsuccess = () => resolve(open.result as OfflineDatabase);
    open.onerror = () =>
      reject(open.error ?? new Error("Could not open offline storage"));
  });

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);

const networkFailure = (error: unknown): boolean =>
  /failed to fetch|network(?:error)?|offline|load failed|fetch failed|timeout/i.test(errorMessage(error));

/**
 * Officer-only offline cache and mutation queue.  The server remains the
 * source of truth: local records are used only when connectivity is missing,
 * then operations are replayed in creation order once Supabase is reachable.
 */
class OfflineSyncService {
  private ownerId: string | null = null;
  private enabled = false;
  private state: SyncState = onlineNow() ? "online" : "offline";
  private listeners = new Set<() => void>();
  private syncInProgress = false;
  private initialized = false;

  configure(userId: string | null, role: UserRole | null): void {
    this.ownerId = userId;
    this.enabled = Boolean(userId && role && OFFICER_ROLES.includes(role));
    this.state = onlineNow() ? "online" : "offline";
    this.emit();
    if (this.enabled && onlineNow()) void this.sync();
  }

  start(): void {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;
    window.addEventListener("offline", this.handleOffline);
    window.addEventListener("online", this.handleOnline);
  }

  stop(): void {
    if (!this.initialized || typeof window === "undefined") return;
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
    this.initialized = false;
  }

  private handleOffline = (): void => {
    this.state = "offline";
    this.emit();
  };

  private handleOnline = (): void => {
    if (!this.isEnabled()) return;
    this.state = "online";
    this.emit();
    void this.sync();
  };

  isEnabled(): boolean {
    return this.enabled && Boolean(this.ownerId) && hasIndexedDb();
  }

  isOffline(): boolean {
    return this.isEnabled() && !onlineNow();
  }

  getState(): SyncState {
    return this.isEnabled() ? this.state : "online";
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  // One shared connection; opening a new one per call leaked connections.
  private db: Promise<OfflineDatabase> | null = null;

  private database(): Promise<OfflineDatabase> {
    if (!hasIndexedDb())
      return Promise.reject(new Error("Offline storage is not available in this browser."));
    if (!this.db) {
      this.db = openDatabase().then((database) => {
        database.onclose = () => (this.db = null);
        database.onversionchange = () => {
          database.close();
          this.db = null;
        };
        return database;
      });
      this.db.catch(() => (this.db = null));
    }
    return this.db;
  }

  // Cache writes are read-modify-write; serialize them so concurrent
  // mutations (e.g. a batched import) can't overwrite each other's records.
  private cacheLock: Promise<unknown> = Promise.resolve();

  async read<T>(table: TableName): Promise<T[] | null> {
    if (!this.isEnabled() || !this.ownerId) return null;
    const database = await this.database();
    const transaction = database.transaction("tables", "readonly");
    const entry = (await request(
      transaction.objectStore("tables").get(cacheKey(this.ownerId, table)),
    )) as CachedTable<T> | undefined;
    await transactionDone(transaction);
    return entry?.records ?? null;
  }

  async cache<T>(table: TableName, records: T[]): Promise<void> {
    if (!this.isEnabled() || !this.ownerId) return;
    const database = await this.database();
    const transaction = database.transaction("tables", "readwrite");
    const store = transaction.objectStore("tables");
    store.put({
      key: cacheKey(this.ownerId, table),
      ownerId: this.ownerId,
      table,
      records,
      updatedAt: Date.now(),
    } satisfies CachedTable<T>);
    await transactionDone(transaction);
  }

  private mutateCache<T>(
    table: TableName,
    kind: MutationKind,
    recordId: string,
    makeLocal?: (current: T | undefined) => T,
  ): Promise<T | undefined> {
    const run = this.cacheLock.then(() => this.applyToCache(table, kind, recordId, makeLocal));
    this.cacheLock = run.catch(() => undefined);
    return run;
  }

  private async applyToCache<T>(
    table: TableName,
    kind: MutationKind,
    recordId: string,
    makeLocal?: (current: T | undefined) => T,
  ): Promise<T | undefined> {
    if (!this.isEnabled() || !this.ownerId) return undefined;
    const current = await this.read<T>(table);
    const records = current ?? [];
    const index = records.findIndex(
      (record) => String((record as { id?: unknown }).id) === recordId,
    );
    if (kind === "delete") {
      if (index >= 0)
        await this.cache(
          table,
          records.filter((_, itemIndex) => itemIndex !== index),
        );
      return undefined;
    }
    const next = makeLocal?.(index >= 0 ? records[index] : undefined);
    if (!next) return undefined;
    const nextRecords =
      index >= 0
        ? records.map((record, itemIndex) =>
            itemIndex === index ? next : record,
          )
        : [...records, next];
    await this.cache(table, nextRecords);
    return next;
  }

  // Date.now() alone is only millisecond-resolution. A contribution create
  // followed immediately by a payment create that references it (the normal
  // "first payment for this event" flow) can enqueue within the same
  // millisecond, tying their by_owner_created sort key — at which point
  // IndexedDB falls back to ordering by the random `key` UUID instead of
  // insertion order, so the dependent payment can replay *before* the
  // contribution it points to even exists in the database. Tracking the
  // last-issued timestamp and never handing out the same value twice
  // guarantees strict FIFO replay order regardless of clock resolution.
  private lastMutationTimestamp = 0;

  private nextMutationTimestamp(): number {
    const now = Date.now();
    this.lastMutationTimestamp = Math.max(now, this.lastMutationTimestamp + 1);
    return this.lastMutationTimestamp;
  }

  private async enqueue(
    mutation: Omit<
      QueuedMutation,
      "key" | "ownerId" | "createdAt" | "attempts"
    >,
    fileStorage?: { bucket: string; path: string; blob: Blob },
  ): Promise<void> {
    if (!this.ownerId) return;
    const database = await this.database();
    const storeNames: "mutations" | ("mutations" | "uploads")[] = fileStorage
      ? ["mutations", "uploads"]
      : "mutations";
    const transaction = database.transaction(storeNames, "readwrite");
    const key = crypto.randomUUID();
    transaction.objectStore("mutations").put({
      ...mutation,
      key,
      ownerId: this.ownerId,
      createdAt: this.nextMutationTimestamp(),
      attempts: 0,
    } satisfies QueuedMutation);
    if (fileStorage) {
      transaction.objectStore("uploads").put({
        key,
        ownerId: this.ownerId,
        bucket: fileStorage.bucket,
        path: fileStorage.path,
        blob: fileStorage.blob,
      } satisfies PendingUpload);
    }
    await transactionDone(transaction);
  }

  async mutation<T>(params: {
    table: TableName;
    kind: MutationKind;
    recordId: string;
    payload: Record<string, unknown>;
    fileStorage?: { bucket: string; path: string; blob: Blob };
    makeLocal?: (current: T | undefined) => T;
    executeOnline: () => Promise<T>;
  }): Promise<T | undefined> {
    const duringSync = this.syncInProgress;
    const queueOffline = async (): Promise<T | undefined> => {
      const local = await this.mutateCache<T>(
        params.table,
        params.kind,
        params.recordId,
        params.makeLocal,
      );
      await this.enqueue(
        {
          id: crypto.randomUUID(),
          table: params.table,
          kind: params.kind,
          recordId: params.recordId,
          payload: params.payload,
        },
        params.fileStorage,
      );
      if (duringSync) {
        // The running sync may already have drained the queue; make sure
        // this write still gets sent.
        if (!this.syncInProgress) void this.sync();
      } else {
        this.state = "offline";
        this.emit();
      }
      return local;
    };

    if (!this.isEnabled()) return params.executeOnline();
    // While a replay is running, queue behind it so a new write can't reach
    // Supabase before the queued writes it may depend on.
    if (this.isOffline() || duringSync) return queueOffline();
    try {
      const result = await params.executeOnline();
      await this.mutateCache<T>(
        params.table,
        params.kind,
        params.recordId,
        () => result,
      );
      return result;
    } catch (error) {
      if (!networkFailure(error)) throw error;
      // navigator.onLine can remain true while a network request is failing
      // (for example, when Wi-Fi is connected but has no internet access).
      // Treat that condition as offline immediately so the mutation is queued
      // and the UI remains usable instead of waiting on repeated requests.
      this.state = "offline";
      this.emit();
      return queueOffline();
    }
  }

  private async queuedMutations(): Promise<QueuedMutation[]> {
    if (!this.ownerId) return [];
    const database = await this.database();
    const transaction = database.transaction("mutations", "readonly");
    const index = transaction
      .objectStore("mutations")
      .index("by_owner_created");
    const entries = await request(
      index.getAll(
        IDBKeyRange.bound(
          [this.ownerId, 0],
          [this.ownerId, Number.MAX_SAFE_INTEGER],
        ),
      ),
    );
    await transactionDone(transaction);
    return entries as QueuedMutation[];
  }

  private async removeMutation(key: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction("mutations", "readwrite");
    transaction.objectStore("mutations").delete(key);
    await transactionDone(transaction);
  }

  /** Number of local changes that have not yet reached Supabase — queued
   *  because we were offline, or stuck after a failed replay. */
  async pendingCount(): Promise<number> {
    return (await this.queuedMutations()).length;
  }

  /**
   * The change that is currently blocking sync, if any. Mutations replay in
   * strict creation order (so a create is never applied after its own
   * update), which means a single bad mutation stalls every mutation queued
   * behind it. Surfacing *this specific one* — table + the real Postgres/
   * PostgREST error — is what actually tells you why nothing is reaching
   * the database, instead of a generic "sync failed".
   */
  async firstFailure(): Promise<{ table: TableName; message: string } | null> {
    const [next] = await this.queuedMutations();
    if (!next?.lastError) return null;
    return { table: next.table, message: next.lastError };
  }

  /**
   * Permanently drops the oldest queued mutation without sending it to
   * Supabase. Use only when a change can never succeed (e.g. it was created
   * against a schema that has since changed) and is blocking every
   * mutation queued after it. This does not touch the database — the
   * change is simply forgotten on this device.
   */
  async discardOldest(): Promise<void> {
    const [next] = await this.queuedMutations();
    if (!next) return;
    await this.removeMutation(next.key);
    // Drop any pending Storage blob parked for this mutation so it isn't
    // orphaned now that the owning DB change is being forgotten.
    await this.removeUpload(next.key);
  }

  private async recordFailure(
    mutation: QueuedMutation,
    error: unknown,
  ): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction("mutations", "readwrite");
    transaction.objectStore("mutations").put({
      ...mutation,
      attempts: mutation.attempts + 1,
      lastError: errorMessage(error),
    });
    await transactionDone(transaction);
  }

  /**
   * Persists an in-flight `payload` back to the queued mutation record. Used
   * after a pending Storage upload succeeds so a later DB write failure (or
   * dropped response) doesn't replay the row without the file URL.
   */
  private async savePayload(
    key: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction("mutations", "readwrite");
    const store = transaction.objectStore("mutations");
    const current = (await request(store.get(key))) as
      | QueuedMutation
      | undefined;
    if (current) {
      store.put({
        ...current,
        payload: { ...current.payload, ...payload },
      });
    }
    await transactionDone(transaction);
  }

  private async pendingUpload(key: string): Promise<PendingUpload | null> {
    if (!this.ownerId) return null;
    const database = await this.database();
    const transaction = database.transaction("uploads", "readonly");
    const entry = (await request(
      transaction.objectStore("uploads").get(key),
    )) as PendingUpload | undefined;
    await transactionDone(transaction);
    return entry ?? null;
  }

  private async removeUpload(key: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction("uploads", "readwrite");
    transaction.objectStore("uploads").delete(key);
    await transactionDone(transaction);
  }

  private async replay(mutation: QueuedMutation): Promise<void> {
    // student_requirement_files rows point at a file in Supabase Storage. When
    // the create/replace was queued offline the blob was parked in the uploads
    // store; push it to Storage first and stamp the resulting public URL into
    // the payload so the DB insert/update below references a live file.
    const upload = await this.pendingUpload(mutation.key);
    if (upload && !mutation.payload.file_url) {
      const { error: uploadError } = await getSupabase()
        .storage.from(upload.bucket)
        .upload(upload.path, upload.blob, {
          upsert: false,
          contentType: upload.blob.type,
        });
      if (uploadError) throw new Error(uploadError.message);
      const { data } = getSupabase()
        .storage.from(upload.bucket)
        .getPublicUrl(upload.path);
      mutation.payload.file_url = data.publicUrl;
      // Persist the public URL so an interrupted sync (upload succeeded, DB
      // write failed) doesn't replay the row without a file reference.
      await this.savePayload(mutation.key, { file_url: data.publicUrl });
      // The blob reached Storage; drop it so a retry skips the upload.
      await this.removeUpload(mutation.key);
    }

    const query = getSupabase().from(mutation.table);
    let error: { message?: string } | null = null;
    if (mutation.kind === "create") {
      // Client-created ids are primary keys. Upsert makes an interrupted replay
      // idempotent: if Supabase accepted a prior request but the response was
      // lost, this retry updates that exact same row instead of creating a copy.
      ({ error } = await query.upsert(
        { id: mutation.recordId, ...mutation.payload },
        { onConflict: "id" },
      ));
    } else if (mutation.kind === "update") {
      ({ error } = await query
        .update(mutation.payload)
        .eq("id", mutation.recordId));
    } else {
      ({ error } = await query.delete().eq("id", mutation.recordId));
    }
    if (error)
      throw new Error(error.message ?? "Supabase synchronization failed");
  }

  async sync(): Promise<void> {
    if (!this.isEnabled() || !onlineNow() || this.syncInProgress) return;
    this.syncInProgress = true;
    this.state = "syncing";
    this.emit();
    try {
      // Re-read the queue each pass: writes made during sync are appended to it.
      for (let mutation; (mutation = (await this.queuedMutations())[0]); ) {
        try {
          await this.replay(mutation);
          await this.removeMutation(mutation.key);
        } catch (error) {
          await this.recordFailure(mutation, error);
          this.state = networkFailure(error) ? "offline" : "failed";
          this.emit();
          return;
        }
      }
      this.state = "synced";
      this.emit();
    } catch (error) {
      this.state = networkFailure(error) ? "offline" : "failed";
      this.emit();
    } finally {
      this.syncInProgress = false;
    }
    // Catch writes queued while the last pass was finishing.
    if (this.state === "synced" && (await this.pendingCount()) > 0) void this.sync();
  }
}

export const offlineSyncService = new OfflineSyncService();
