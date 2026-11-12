import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { offlineSyncService, type SyncState } from "@/lib/offlineSync";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

type Failure = { table: string; message: string };

const pill = "fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium shadow-lift";
const plural = (n: number) => `${n} change${n === 1 ? "" : "s"}`;

export default function SyncStatusBadge() {
  const [state, setState] = useState<SyncState>(() => offlineSyncService.getState());
  const [pending, setPending] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [showSynced, setShowSynced] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let prev = offlineSyncService.getState();

    const refresh = async (next: SyncState, toastFailure: boolean) => {
      const [count, current] = await Promise.all([offlineSyncService.pendingCount(), offlineSyncService.firstFailure()]);
      if (cancelled) return;
      setPending(count);
      setFailure(current);
      // Toast only on entering "failed"; the persistent card covers the rest.
      if (toastFailure && next === "failed" && current) toast.error(`A ${current.table} change couldn't sync`, { description: current.message });
    };

    void refresh(prev, true);
    const unsubscribe = offlineSyncService.subscribe(() => {
      const next = offlineSyncService.getState();
      setState(next);
      void refresh(next, prev !== "failed");
      prev = next;
      clearTimeout(hideTimer);
      if (next === "synced") {
        setShowSynced(true);
        hideTimer = setTimeout(() => setShowSynced(false), 2000);
      } else if (next !== "offline") {
        setShowSynced(false);
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(hideTimer);
      unsubscribe();
    };
  }, []);

  const retry = async () => {
    setRetrying(true);
    try {
      await offlineSyncService.sync();
    } finally {
      setRetrying(false);
    }
  };

  const discard = async () => {
    setConfirmDiscard(false);
    await offlineSyncService.discardOldest();
    void offlineSyncService.sync();
  };

  if (state === "failed" && failure) {
    return (
      <>
        <div className="card fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] border-danger/40 p-4 text-sm shadow-lift">
          <p className="flex items-start gap-2 font-semibold text-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <span>
              Couldn&apos;t sync a {failure.table} change{pending > 1 ? ` (${pending} pending)` : ""}
            </span>
          </p>
          <p className="mt-1 break-words pl-6 text-xs text-muted">{failure.message}</p>
          <div className="mt-3 flex gap-2 pl-6">
            <button onClick={retry} disabled={retrying} className="btn btn-primary btn-sm">
              {retrying ? "Retrying…" : "Retry"}
            </button>
            <button onClick={() => setConfirmDiscard(true)} className="btn btn-secondary btn-sm">
              Discard change
            </button>
          </div>
        </div>
        <ConfirmDialog
          open={confirmDiscard}
          onClose={() => setConfirmDiscard(false)}
          onConfirm={discard}
          title={`Discard the queued ${failure.table} change?`}
          description="It keeps failing to sync. Discarding removes it from this device only — it will never be saved to the database."
          confirmLabel="Discard"
        />
      </>
    );
  }

  if (state === "syncing")
    return (
      <div className={pill}>
        <Loader2 className="h-4 w-4 animate-spin text-brand-500" /> Syncing {plural(pending)}…
      </div>
    );

  if (state === "offline" && pending > 0)
    return (
      <div className={`${pill} text-muted`}>
        <CloudOff className="h-4 w-4 shrink-0" /> Offline — {plural(pending)} will sync when you&apos;re back online
      </div>
    );

  if (state === "synced" && showSynced)
    return (
      <div className={`${pill} text-success`}>
        <CheckCircle2 className="h-4 w-4" /> All changes synced
      </div>
    );

  return null;
}
