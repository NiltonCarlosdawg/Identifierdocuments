import { useEffect, useState, useCallback, useRef } from "react";
import { useAuthStore } from "../stores/authStore";
import { useAppConfigStore } from "../stores/configStore";
import { api } from "../../infrastructure/di/container";
import type { AppNotification } from "../../domain/entities/Notification";

export const NOTIFICATION_LABELS: Record<string, string> = {
  "approval:pending": "Nova aprovação pendente",
  "approval:approved": "Documento aprovado",
  "approval:rejected": "Documento rejeitado",
  "document:shared": "Documento partilhado consigo",
  "document:share_revoked": "Partilha revogada",
  "access:requested": "Pedido de acesso",
  "access:granted": "Acesso concedido",
  "access:rejected": "Acesso negado",
  "sync:complete": "Sincronização concluída",
};

export function notificationLabel(type: string): string {
  return NOTIFICATION_LABELS[type] || type;
}

export function useNotifications() {
  const token = useAuthStore(s => s.token);
  const apiBaseUrl = useAppConfigStore(s => s.apiBaseUrl);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<Array<{ id: string; type: string; message: string }>>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unreadCount = notifications.filter(n => !n.isRead).length;

  const loadNotifications = useCallback(async () => {
    if (!token) return;
    try { const res = await api.get<{ data: AppNotification[] }>("/notifications?limit=30"); setNotifications(res.data || []); } catch {}
  }, [token]);

  const markRead = useCallback(async (id: string) => {
    await api.patch(`/notifications/${id}/read`, {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  }, []);

  const addToast = useCallback((type: string, payload: Record<string, unknown>) => {
    const id = crypto.randomUUID();
    const identifier = payload.identifier as string | undefined;
    const label = NOTIFICATION_LABELS[type] ?? "Nova notificação";
    const message = identifier ? `${label}: ${identifier}` : label;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  useEffect(() => {
    if (!token) return;
    loadNotifications();
    // A polling mantém-se como fallback quando o EventSource falha ou o stream cai.
    intervalRef.current = setInterval(loadNotifications, 15000);

    let source: EventSource | null = null;
    if (typeof EventSource !== "undefined") {
      try {
        const url = `${apiBaseUrl}/notifications/stream?access_token=${encodeURIComponent(token)}`;
        source = new EventSource(url);
        // O servidor envia eventos com nomes (ex.: access:granted), não no canal default.
        // "connected" não é registado — só confirma a ligação.
        const handleEvent = (event: Event) => {
          const messageEvent = event as MessageEvent<string>;
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(messageEvent.data || "{}"); } catch {}
          addToast(event.type, payload);
          void loadNotifications();
        };
        for (const type of Object.keys(NOTIFICATION_LABELS)) source.addEventListener(type, handleEvent);
      } catch {
        source?.close();
        source = null;
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      source?.close();
    };
  }, [token, apiBaseUrl, loadNotifications, addToast]);

  return { notifications, unreadCount, toasts, loadNotifications, markRead };
}
