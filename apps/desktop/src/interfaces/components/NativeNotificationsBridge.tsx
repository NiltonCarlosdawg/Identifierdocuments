import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../infrastructure/di/container";
import { useAppConfigStore } from "../stores/configStore";
import { useQueueStore } from "../stores/queueStore";
import { useWriteQueueStore } from "../stores/writeQueueStore";
import { useWatcherStore } from "../stores/watcherStore";
import { ensureNotificationPermission, isTauriRuntime, notifyNative } from "../../shared/helpers/notifications";

function prefs() {
  return useAppConfigStore.getState().notificationPrefs;
}

/**
 * Bridge global: escuta eventos Tauri da fila offline / sync / watcher e
 * dispara notificações nativas (respeitando preferências).
 * Montado no Layout autenticado — não depende de Settings estar aberto.
 */
export default function NativeNotificationsBridge() {
  const setNotificationPrefs = useAppConfigStore(s => s.setNotificationPrefs);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    void ensureNotificationPermission();

    (async () => {
      try {
        const res = await api.get<{ notificationPreferences?: Record<string, boolean>; data?: { notificationPreferences?: Record<string, boolean> } }>("/auth/me");
        const remote = res.notificationPreferences ?? res.data?.notificationPreferences;
        if (remote && typeof remote === "object") setNotificationPrefs(remote);
      } catch {
        // offline / sem sessão — mantém prefs locais
      }
    })();

    const unlisteners: Array<() => void> = [];

    void (async () => {
      unlisteners.push(await listen<{ uploaded: number }>("sync:complete", (e) => {
        useQueueStore.getState().refresh().catch(() => {});
        useWriteQueueStore.getState().refresh().catch(() => {});
        const n = e.payload?.uploaded ?? 0;
        if (n > 0) {
          void notifyNative(prefs(), "sync_complete", "Sincronização concluída", `${n} documento(s) enviado(s) para o servidor.`);
        }
      }));

      unlisteners.push(await listen<{ filename?: string; identifier?: string; error?: string; attempts?: number }>("sync:failed", (e) => {
        useQueueStore.getState().refresh().catch(() => {});
        const name = e.payload?.filename || e.payload?.identifier || "documento";
        const attempts = e.payload?.attempts;
        void notifyNative(
          prefs(),
          "sync_failed",
          "Falha na sincronização",
          attempts != null
            ? `${name} falhou (tentativa ${attempts}).`
            : `${name} falhou ao enviar.`,
        );
      }));

      unlisteners.push(await listen<{ filename?: string; identifier?: string }>("queue:enqueued", (e) => {
        useQueueStore.getState().refresh().catch(() => {});
        const name = e.payload?.filename || "Documento";
        void notifyNative(
          prefs(),
          "queue_enqueued",
          "Guardado na fila offline",
          `${name} será enviado quando houver ligação.`,
        );
      }));

      unlisteners.push(await listen<{ method?: string; path?: string }>("write:enqueued", (e) => {
        useWriteQueueStore.getState().refresh().catch(() => {});
        const path = e.payload?.path || "alteração";
        void notifyNative(
          prefs(),
          "write_enqueued",
          "Escrita pendente",
          `${e.payload?.method || "PATCH"} ${path} ficará sincronizada quando houver ligação.`,
        );
      }));

      unlisteners.push(await listen<{ path?: string }>("watcher:file_detected", (e) => {
        useWatcherStore.getState().bumpDetected();
        void notifyNative(prefs(), "watcher_detected", "Documento detectado", `Ficheiro novo em ${e.payload?.path ?? "pasta vigiada"}`);
      }));

      unlisteners.push(await listen<{ path?: string; identifier?: string }>("watcher:identifier_found", (e) => {
        useWatcherStore.getState().bumpDetected();
        void notifyNative(
          prefs(),
          "watcher_detected",
          "Identificador encontrado",
          `O documento contém ${e.payload?.identifier ?? "um identificador"}`,
        );
      }));
    })();

    return () => { unlisteners.forEach(fn => fn()); };
  }, [setNotificationPrefs]);

  return null;
}
