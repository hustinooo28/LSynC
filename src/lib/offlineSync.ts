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
  | "student_requirement_files";
type MutationKind = "create" | "update" | "delete";
type StoreName = "tables" | "mutations" | "uploads";
type FileStorage = { bucket: string; path: string; blob: Blob };

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

/** A blob to push to Storage before its mutation (keyed by the same `key`) replays. */
interface PendingUpload extends FileStorage {
  key: string;
  ownerId: string;
}

const DB_NAME = "digital-transparency-board-offline";
const DB_VERSION = 2;

const hasIndexedDb = (): boolean => typeof indexedDB !== "undefined";
const onlineNow = (): boolean => typeof navigator === "undefined" || navigator.onLine;
const cacheKey = (ownerId: string, table: TableName) => `${ownerId}:${table}`;

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });

const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("tables")) db.createObjectStore("tables", { keyPath: "key" });
      if (!db.objectStoreNames.contains("mutations")) {
        db.createObjectStore("mutations", { keyPath: "key" }).createIndex("by_owner_created", ["ownerId", "createdAt"]);
      }
      if (!db.objectStoreNames.contains("uploads")) db.createObjectStore("uploads", { keyPath: "key" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("Could not open offline storage"));
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
 * Officer-only offline cache and mutation queue. The server stays the source
 * of truth: cached records are used only without connectivity, and queued
 * writes replay in creation order once Supabase is reachable.
 */
class OfflineSyncService {
  private ownerId: string | null = null;
  private enabled = false;
  private state: SyncState = onlineNow() ? "online" : "offline";
  private listeners = new Set<() => void>();
  private syncInProgress = false;
  private initialized = false;
  // One shared connection (opening one per call leaked connections).
  private db: Promise<IDBDatabase> | null = null;
  // Cache updates are read-modify-write; serialized so concurrent mutations
  // (e.g. a batched import) can't drop each other's records.
  private cacheLock: Promise<unknown> = Promise.resolve();
  // Date.now() alone can tie within a millisecond, letting IndexedDB order a
  // dependent write (payment) before its parent (contribution) by random key.
  private lastMutationTimestamp = 0;

  configure(userId: string | null, role: UserRole | null): void {
    this.ownerId = userId;
    this.enabled = Boolean(userId && role); // every UserRole is an officer role
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

  private handleOffline = (): void => this.setState("offline");

  private handleOnline = (): void => {
    if (!this.isEnabled()) return;
    this.setState("online");
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

  private setState(state: SyncState): void {
    this.state = state;
    this.emit();
  }

  private database(): Promise<IDBDatabase> {
    if (!hasIndexedDb()) return Promise.reject(new Error("Offline storage is not available in this browser."));
    if (!this.db) {
      const opening = openDatabase().then((db) => {
        db.onclose = () => (this.db = null);
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        return db;
      });
      opening.catch(() => (this.db = null));
      this.db = opening;
    }
    return this.db;
  }

  /** Runs `fn` in one IndexedDB transaction and resolves once it commits. */
  private async withStores<R>(
    stores: StoreName | StoreName[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<R> | R,
  ): Promise<R> {
    const tx = (await this.database()).transaction(stores, mode);
    const done = transactionDone(tx);
    try {
      const result = await fn(tx);
      await done;
      return result;
    } catch (error) {
      done.catch(() => undefined);
      throw error;
    }
  }

  async read<T>(table: TableName): Promise<T[] | null> {
    const ownerId = this.ownerId;
    if (!this.isEnabled() || !ownerId) return null;
    const entry = await this.withStores("tables", "readonly", (tx) =>
      request(tx.objectStore("tables").get(cacheKey(ownerId, table))),
    );
    return (entry as CachedTable<T> | undefined)?.records ?? null;
  }

  async cache<T>(table: TableName, records: T[]): Promise<void> {
    const ownerId = this.ownerId;
    if (!this.isEnabled() || !ownerId) return;
    await this.withStores("tables", "readwrite", (tx) => {
      tx.objectStore("tables").put({
        key: cacheKey(ownerId, table),
        ownerId,
        table,
        records,
        updatedAt: Date.now(),
      } satisfies CachedTable<T>);
    });
  }

  private mutateCache<T>(
    table: TableName,
    kind: MutationKind,
    recordId: string,
    makeLocal?: (current: T | undefined) => T,
  ): Promise<T | undefined> {
    const run = this.cacheLock.then(async () => {
      if (!this.isEnabled()) return undefined;
      const records = (await this.read<T>(table)) ?? [];
      const index = records.findIndex((record) => String((record as { id?: unknown }).id) === recordId);
      if (kind === "delete") {
        if (index >= 0) await this.cache(table, records.filter((_, i) => i !== index));
        return undefined;
      }
      const next = makeLocal?.(index >= 0 ? records[index] : undefined);
      if (!next) return undefined;
      await this.cache(table, index >= 0 ? records.map((record, i) => (i === index ? next : record)) : [...records, next]);
      return next;
    });
    this.cacheLock = run.catch(() => undefined);
    return run;
  }

  private async enqueue(
    mutation: Pick<QueuedMutation, "table" | "kind" | "recordId" | "payload">,
    fileStorage?: FileStorage,
  ): Promise<void> {
    const ownerId = this.ownerId;
    if (!ownerId) return;
    const key = crypto.randomUUID();
    this.lastMutationTimestamp = Math.max(Date.now(), this.lastMutationTimestamp + 1);
    const createdAt = this.lastMutationTimestamp;
    await this.withStores(fileStorage ? ["mutations", "uploads"] : "mutations", "readwrite", (tx) => {
      tx.objectStore("mutations").put({
        ...mutation,
        id: crypto.randomUUID(),
        key,
        ownerId,
        createdAt,
        attempts: 0,
      } satisfies QueuedMutation);
      if (fileStorage) tx.objectStore("uploads").put({ ...fileStorage, key, ownerId } satisfies PendingUpload);
    });
  }

  /**
   * Runs `executeOnline` when possible and mirrors the result into the cache;
   * otherwise (offline, a network failure, or a sync in progress) applies
   * `makeLocal` to the cache and queues the write for replay.
   */
  async mutation<T>(params: {
    table: TableName;
    kind: MutationKind;
    recordId: string;
    payload: Record<string, unknown>;
    fileStorage?: FileStorage;
    makeLocal?: (current: T | undefined) => T;
    executeOnline: () => Promise<T>;
  }): Promise<T | undefined> {
    const { table, kind, recordId, payload } = params;
    // Writes made while a replay runs queue behind it, so they can't reach
    // Supabase before the queued writes they may depend on.
    const duringSync = this.syncInProgress;

    const queueOffline = async (): Promise<T | undefined> => {
      const local = await this.mutateCache<T>(table, kind, recordId, params.makeLocal);
      await this.enqueue({ table, kind, recordId, payload }, params.fileStorage);
      if (!duringSync) this.setState("offline");
      // The running sync may have drained the queue already; make sure this goes out.
      else if (!this.syncInProgress) void this.sync();
      return local;
    };

    if (!this.isEnabled()) return params.executeOnline();
    if (this.isOffline() || duringSync) return queueOffline();
    try {
      const result = await params.executeOnline();
      await this.mutateCache<T>(table, kind, recordId, () => result);
      return result;
    } catch (error) {
      if (!networkFailure(error)) throw error;
      // navigator.onLine can stay true on a connection with no internet.
      return queueOffline();
    }
  }

  private async queuedMutations(): Promise<QueuedMutation[]> {
    const ownerId = this.ownerId;
    if (!ownerId) return [];
    return this.withStores("mutations", "readonly", (tx) =>
      request(
        tx
          .objectStore("mutations")
          .index("by_owner_created")
          .getAll(IDBKeyRange.bound([ownerId, 0], [ownerId, Number.MAX_SAFE_INTEGER])),
      ),
    ) as Promise<QueuedMutation[]>;
  }

  private deleteKey(store: "mutations" | "uploads", key: string): Promise<void> {
    return this.withStores(store, "readwrite", (tx) => void tx.objectStore(store).delete(key));
  }

  /** Writes not yet on Supabase (queued offline or stuck after a failed replay). */
  async pendingCount(): Promise<number> {
    return (await this.queuedMutations()).length;
  }

  /**
   * The oldest queued write and its error, if it failed. Replay is strictly
   * ordered, so this one write blocks everything queued behind it.
   */
  async firstFailure(): Promise<{ table: TableName; message: string } | null> {
    const [next] = await this.queuedMutations();
    return next?.lastError ? { table: next.table, message: next.lastError } : null;
  }

  /** Forgets the oldest queued write on this device (for writes that can never succeed). */
  async discardOldest(): Promise<void> {
    const [next] = await this.queuedMutations();
    if (!next) return;
    await this.deleteKey("mutations", next.key);
    await this.deleteKey("uploads", next.key);
  }

  /** Merges `patch` into a queued mutation (e.g. failure info or a file URL). */
  private patchMutation(key: string, patch: (current: QueuedMutation) => Partial<QueuedMutation>): Promise<void> {
    return this.withStores("mutations", "readwrite", async (tx) => {
      const store = tx.objectStore("mutations");
      const current = (await request(store.get(key))) as QueuedMutation | undefined;
      if (current) store.put({ ...current, ...patch(current) });
    });
  }

  private async replay(mutation: QueuedMutation): Promise<void> {
    // A requirement-file write queued offline parked its blob in "uploads":
    // upload it first and stamp the public URL into the payload.
    const upload = (await this.withStores("uploads", "readonly", (tx) =>
      request(tx.objectStore("uploads").get(mutation.key)),
    )) as PendingUpload | undefined;
    if (upload && !mutation.payload.file_url) {
      const storage = getSupabase().storage.from(upload.bucket);
      const { error } = await storage.upload(upload.path, upload.blob, {
        upsert: false,
        contentType: upload.blob.type,
      });
      if (error) throw new Error(error.message);
      mutation.payload.file_url = storage.getPublicUrl(upload.path).data.publicUrl;
      // Persist the URL so a retry after a failed DB write skips the upload.
      await this.patchMutation(mutation.key, (current) => ({
        payload: { ...current.payload, file_url: mutation.payload.file_url },
      }));
      await this.deleteKey("uploads", mutation.key);
    }

    const query = getSupabase().from(mutation.table);
    const { error } =
      mutation.kind === "create"
        ? // Upsert on the client-generated id keeps a retried create idempotent.
          await query.upsert({ id: mutation.recordId, ...mutation.payload }, { onConflict: "id" })
        : mutation.kind === "update"
          ? await query.update(mutation.payload).eq("id", mutation.recordId)
          : await query.delete().eq("id", mutation.recordId);
    if (error) throw new Error(error.message ?? "Supabase synchronization failed");
  }

  async sync(): Promise<void> {
    if (!this.isEnabled() || !onlineNow() || this.syncInProgress) return;
    this.syncInProgress = true;
    this.setState("syncing");
    try {
      // Re-read the queue each pass: writes made during sync are appended to it.
      for (let mutation; (mutation = (await this.queuedMutations())[0]); ) {
        try {
          await this.replay(mutation);
          await this.deleteKey("mutations", mutation.key);
        } catch (error) {
          const lastError = errorMessage(error);
          await this.patchMutation(mutation.key, (current) => ({ attempts: current.attempts + 1, lastError }));
          throw error;
        }
      }
      this.setState("synced");
    } catch (error) {
      this.setState(networkFailure(error) ? "offline" : "failed");
    } finally {
      this.syncInProgress = false;
    }
    // Catch writes queued while the last pass was finishing.
    if (this.state === "synced") {
      const pending = await this.pendingCount().catch(() => 0);
      if (pending > 0) void this.sync();
    }
  }
}

export const offlineSyncService = new OfflineSyncService();
