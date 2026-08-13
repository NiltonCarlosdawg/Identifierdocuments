export type NativeNotificationKey =
  | "sync_complete"
  | "sync_failed"
  | "queue_enqueued"
  | "write_enqueued"
  | "watcher_detected";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let permissionResolved = false;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
  try {
    const granted = await isPermissionGranted();
    if (granted) return true;
    if (!permissionResolved) {
      permissionResolved = true;
      const result = await requestPermission();
      return result === "granted";
    }
    return false;
  } catch {
    return false;
  }
}

export async function sendNativeNotification(title: string, body: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return;
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    sendNotification({ title, body });
  } catch {
    // Notificações nativas são best-effort; nunca quebram o fluxo principal.
  }
}

/** Preferência em falta = activa (opt-out). */
export function isNativePrefEnabled(prefs: Record<string, boolean>, key: NativeNotificationKey): boolean {
  if (!(key in prefs)) return true;
  return !!prefs[key];
}

export async function notifyNative(
  prefs: Record<string, boolean>,
  key: NativeNotificationKey,
  title: string,
  body: string,
): Promise<void> {
  if (!isNativePrefEnabled(prefs, key)) return;
  await sendNativeNotification(title, body);
}
