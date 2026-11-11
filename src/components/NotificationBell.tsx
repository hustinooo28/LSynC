import { useEffect, useState } from "react";
import { Bell, BellRing, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Menu, MenuContent, MenuTrigger } from "@/components/ui/Menu";
import { notificationsService as svc, type AppNotification } from "@/services/notificationsService";
import type { ViewState } from "@/types";
import { cn } from "@/lib/utils";
import SendNotificationModal from "@/components/SendNotificationModal";
import { isPushSupported, getExistingSubscription, subscribeStudentToPush, subscribeOfficerToPush, unsubscribeFromPush } from "@/lib/push";

const LAST_SEEN_KEY = "dtb-public-notifications-last-seen";

interface NotificationBellProps {
  onNavigate: (view: ViewState) => void;
  /** Signed-in officer vs. anyone browsing the public site. */
  isLoggedIn: boolean;
  /** Set once a visitor has verified name + Student ID via the landing search. */
  studentId?: string;
  triggerClassName?: string;
}

/**
 * Three audiences with different trust models:
 * - officer: own + all_officers rows (RLS), server-tracked read state;
 * - verified student: all_students broadcasts + their own targeted rows;
 * - anonymous: all_students broadcasts only.
 * Students have no login, so "seen" is a local, purely cosmetic timestamp.
 */
export default function NotificationBell({ onNavigate, isLoggedIn, studentId, triggerClassName }: NotificationBellProps) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(() => localStorage.getItem(LAST_SEEN_KEY) ?? "");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const personal = isLoggedIn || !!studentId;

  useEffect(() => {
    if (!isPushSupported()) return;
    getExistingSubscription()
      .then((sub) => setPushEnabled(!!sub))
      .catch(() => setPushEnabled(false));
  }, [isLoggedIn, studentId]);

  useEffect(() => {
    const add = (n: AppNotification) => setItems((prev) => (prev.some((i) => i.id === n.id) ? prev : [n, ...prev]));
    const [load, unsubscribe] = isLoggedIn
      ? [svc.getForOfficer(), svc.subscribeOfficer(add)]
      : studentId
        ? [svc.getForStudent(studentId), svc.subscribeStudent(studentId, add)]
        : [svc.getPublicBroadcasts(), svc.subscribePublicBroadcasts(add)];
    let live = true;
    load.then((rows) => live && setItems(rows)).catch((error) => console.error("Failed to load notifications:", error));
    return () => {
      live = false;
      unsubscribe();
    };
  }, [isLoggedIn, studentId]);

  const unread = items.filter((n) => (isLoggedIn ? !n.readAt : n.createdAt > lastSeen)).length;
  const markRead = (ids: string[] | "all") =>
    setItems((prev) => prev.map((i) => (ids === "all" || ids.includes(i.id) ? { ...i, readAt: i.readAt ?? new Date().toISOString() } : i)));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !isLoggedIn) {
      const now = new Date().toISOString();
      localStorage.setItem(LAST_SEEN_KEY, now);
      setLastSeen(now);
    }
  };

  const handleSelect = async (n: AppNotification) => {
    if (isLoggedIn && !n.readAt) {
      try {
        await svc.markAsRead(n.id);
        markRead([n.id]);
      } catch (error) {
        console.error("Failed to mark notification read:", error);
      }
    }
    // `link` holds a ViewState set by officer-only notification triggers.
    if (n.link) {
      setOpen(false);
      onNavigate(n.link as ViewState);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await svc.deleteNotification(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (error) {
      console.error("Failed to delete notification:", error);
      toast.error("Failed to delete notification.");
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await svc.markAllReadForOfficer();
      markRead("all");
    } catch (error) {
      console.error("Failed to mark notifications read:", error);
      toast.error("Couldn't mark notifications as read.");
    }
  };

  const handleTogglePush = async () => {
    setPushBusy(true);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        setPushEnabled(false);
        toast.success("Push notifications turned off.");
        return;
      }
      const result = isLoggedIn ? await subscribeOfficerToPush() : await subscribeStudentToPush(studentId!);
      if (result.ok) {
        setPushEnabled(true);
        toast.success("Push notifications enabled.");
      } else {
        toast.error(result.reason === "permission-denied" ? "Notification permission was denied." : "Couldn't enable push notifications on this device.");
      }
    } catch (error) {
      console.error("Push toggle failed:", error);
      toast.error("Couldn't update push notifications.");
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <>
      <Menu open={open} onOpenChange={handleOpenChange}>
        <MenuTrigger asChild>
          <button className={cn("relative", triggerClassName ?? "btn btn-ghost btn-icon")} aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"}>
            <Bell className="h-[18px] w-[18px]" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        </MenuTrigger>

        <MenuContent sideOffset={10} className="w-[min(22rem,calc(100vw-2rem))] p-0">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <span className="text-sm font-bold text-ink">{personal ? "Notifications" : "Announcements"}</span>
            {isLoggedIn && (
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button onClick={handleMarkAllRead} className="btn btn-ghost btn-sm">
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => {
                    setOpen(false);
                    setComposeOpen(true);
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  <Plus className="h-3.5 w-3.5" /> New
                </button>
              </div>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">{personal ? "No notifications yet." : "No announcements yet."}</p>
            ) : (
              items.map((n) => (
                <div key={n.id} className={cn("flex items-start gap-2 border-b border-line px-4 py-3 last:border-b-0", isLoggedIn && !n.readAt && "bg-brand-500/5")}>
                  {isLoggedIn && <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-500")} />}
                  <button onClick={() => handleSelect(n)} className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-semibold text-ink">{n.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">{n.body}</span>
                  </button>
                  {isLoggedIn && (
                    <button onClick={() => handleDelete(n.id)} className="btn btn-ghost btn-sm btn-icon -mr-2 hover:text-danger" aria-label="Delete notification">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {personal && isPushSupported() && (
            <button
              onClick={handleTogglePush}
              disabled={pushBusy}
              className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-xs font-semibold text-brand-600 transition hover:bg-surface-2 disabled:opacity-50"
            >
              <BellRing className="h-3.5 w-3.5" />
              {pushEnabled ? "Turn off push notifications" : "Get push notifications on this device"}
            </button>
          )}
        </MenuContent>
      </Menu>

      {isLoggedIn && <SendNotificationModal open={composeOpen} onOpenChange={setComposeOpen} />}
    </>
  );
}
