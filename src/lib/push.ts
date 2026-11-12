import { notificationsService } from "@/services/notificationsService";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

interface SubscribeResult {
  ok: boolean;
  reason?: "unsupported" | "permission-denied" | "no-vapid-key" | "error";
  message?: string;
}

/** base64url VAPID key -> the byte array the Push API expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const errorResult = (error: unknown): SubscribeResult => ({
  ok: false,
  reason: "error",
  message: error instanceof Error ? error.message : String(error),
});

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js");
  // register() can resolve while still installing; Push needs an active worker.
  await navigator.serviceWorker.ready;
  return registration;
}

/** This browser's existing PushSubscription, or null. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready.catch(() => getRegistration());
  return registration.pushManager.getSubscription();
}

const toKeys = (subscription: PushSubscription) => {
  const { keys } = subscription.toJSON();
  return { endpoint: subscription.endpoint, p256dh: keys?.p256dh ?? "", authKey: keys?.auth ?? "" };
};

type PushKeys = ReturnType<typeof toKeys>;

/** Asks permission, subscribes this browser, then stores the subscription via `save`. */
async function subscribe(save: (keys: PushKeys) => Promise<void>): Promise<SubscribeResult> {
  if (!isPushSupported()) {
    return { ok: false, reason: "unsupported", message: "Push isn't supported in this browser." };
  }
  if (!VAPID_PUBLIC_KEY) {
    console.error("VITE_VAPID_PUBLIC_KEY is not set.");
    return { ok: false, reason: "no-vapid-key", message: "Missing VAPID public key configuration." };
  }
  if ((await Notification.requestPermission()) !== "granted") {
    return { ok: false, reason: "permission-denied", message: "Notification permission was denied." };
  }

  let subscription: PushSubscription;
  try {
    const registration = await getRegistration();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: newer TS libs type the array as Uint8Array<ArrayBufferLike>.
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  } catch (error) {
    console.error("Push subscribe failed:", error);
    return errorResult(error);
  }

  try {
    await save(toKeys(subscription));
    return { ok: true };
  } catch (error) {
    console.error("Saving push subscription failed:", error);
    return errorResult(error);
  }
}

export const subscribeStudentToPush = (studentId: string) =>
  subscribe((keys) => notificationsService.subscribeStudentPush(studentId, keys));
export const subscribeOfficerToPush = () => subscribe(notificationsService.subscribeOfficerPush);
export const subscribeAnonymousToPush = () => subscribe(notificationsService.subscribeAnonymousPush);

/** Re-links an already-subscribed browser to a newly verified student (no new prompt). */
export async function upgradeSubscriptionToStudent(studentId: string): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  try {
    await notificationsService.subscribeStudentPush(studentId, toKeys(subscription));
  } catch (error) {
    console.error("Failed to upgrade push subscription to student:", error);
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  await subscription.unsubscribe();
  await notificationsService.unsubscribePush(subscription.endpoint);
}
