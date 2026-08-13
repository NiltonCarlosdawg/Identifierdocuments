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

    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    (async () => {
      try {
        const res = await api.get<{ notificationPreferences?: Record<string, boolean>; data?: { notificationPreferences?: Record<string, boolean> } } | (Record<string, unknown> & { notificationPreferences?: Record<string, boolean> })>("/auth/me");
        const remote =
          res && typeof res === "object"
            ? (("notificationPreferences" in res && res.notificationPreferences)
              || ("data" in res && res.data && typeof res.data === "object" && "notificationPreferences" in res.data
                ? (res.data as { notificationPreferences?: Record<string, boolean> }).notificationPreferences
                : undefined))
            : undefined;
        if (!cancelled && remote && typeof remote === "object") setNotificationPrefs(remote);
      } catch {
        // offline / sem sessão — mantém prefs locais
      }
    })();

    void (async () => {
      const add = async <T,>(event: string, handler: (payload: T) => void) => {
        const un = await listen<T>(event, (e) => handler(e.payload));
        if (cancelled) { un(); return; }
        unlisteners.push(un);
      };

      await add<{ uploaded: number }>("sync:complete", (payload) => {
        useQueueStore.getState().refresh().catch(() => {});
        useWriteQueueStore.getState().refresh().catch(() => {});
        const n = payload?.uploaded ?? 0;
        if (n > 0) {
          void notifyNative(prefs(), "sync_complete", "Sincronização concluída", `${n} documento(s) enviado(s) para o servidor.`);
        }
      });

      await add<{ filename?: string; identifier?: string; attempts?: number }>("sync:failed", (payload) => {
        useQueueStore.getState().refresh().catch(() => {});
        const name = payload?.filename || payload?.identifier || "documento";
        const attempts = payload?.attempts;
        void notifyNative(
          prefs(),
          "sync_failed",
          "Falha na sincronização",
          attempts != null
            ? `${name} falhou (tentativa ${attempts}).`
            : `${name} falhou ao enviar.`,
        );
      });

      await add<{ filename?: string }>("queue:enqueued", (payload) => {
        useQueueStore.getState().refresh().catch(() => {});
        const name = payload?.filename || "Documento";
        void notifyNative(
          prefs(),
          "queue_enqueued",
          "Guardado na fila offline",
          `${name} será enviado quando houver ligação.`,
        );
      });

      await add<{ method?: string; path?: string }>("write:enqueued", (payload) => {
        useWriteQueueStore.getState().refresh().catch(() => {});
        const path = payload?.path || "alteração";
        void notifyNative(
          prefs(),
          "write_enqueued",
          "Escrita pendente",
          `${payload?.method || "PATCH"} ${path} ficará sincronizada quando houver ligação.`,
        );
      });

      await add<{ path?: string }>("watcher:file_detected", (payload) => {
        useWatcherStore.getState().bumpDetected();
        void notifyNative(prefs(), "watcher_detected", "Documento detectado", `Ficheiro novo em ${payload?.path ?? "pasta vigiada"}`);
      });

      await add<{ identifier?: string }>("watcher:identifier_found", (payload) => {
        useWatcherStore.getState().bumpDetected();
        void notifyNative(
          prefs(),
          "watcher_detected",
          "Identificador encontrado",
          `O documento contém ${payload?.identifier ?? "um identificador"}`,
        );
      });
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach(fn => fn());
    };
  }, [setNotificationPrefs]);

  return null;
}
