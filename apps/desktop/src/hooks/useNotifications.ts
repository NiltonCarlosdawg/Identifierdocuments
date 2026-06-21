import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "../stores/auth";
import { api } from "../services/api";

const BASE_URL = "http://localhost:3000";

export interface AppNotification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export function useNotifications() {
  const token = useAuthStore((s) => s.token);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<Array<{ id: string; type: string; message: string }>>([]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const loadNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.get<{ data: AppNotification[] }>("/notifications?limit=30");
      setNotifications(res.data || []);
    } catch {
      /* offline */
    }
  }, [token]);

  const markRead = useCallback(async (id: string) => {
    await api.patch(`/notifications/${id}/read`, {});
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }, []);

  const addToast = useCallback((type: string, payload: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      "approval:pending": "Nova aprovação pendente",
      "approval:approved": "Documento aprovado",
      "approval:rejected": "Documento rejeitado",
      "document:shared": "Documento partilhado consigo",
      "sync:complete": "Sincronização concluída",
    };
    const id = crypto.randomUUID();
    const identifier = payload.identifier as string | undefined;
    const message = identifier
      ? `${messages[type] || type}: ${identifier}`
      : messages[type] || type;

    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  useEffect(() => {
    if (!token) return;

    loadNotifications();

    const url = `${BASE_URL}/notifications/stream?access_token=${encodeURIComponent(token)}`;
    const source = new EventSource(url);

    const handlers: Array<[string, (e: MessageEvent) => void]> = [
      ["approval:pending", (e) => { addToast("approval:pending", JSON.parse(e.data)); loadNotifications(); }],
      ["approval:approved", (e) => { addToast("approval:approved", JSON.parse(e.data)); loadNotifications(); }],
      ["approval:rejected", (e) => { addToast("approval:rejected", JSON.parse(e.data)); loadNotifications(); }],
      ["document:shared", (e) => { addToast("document:shared", JSON.parse(e.data)); loadNotifications(); }],
      ["sync:complete", (e) => { addToast("sync:complete", JSON.parse(e.data)); }],
    ];

    for (const [event, handler] of handlers) {
      source.addEventListener(event, handler as EventListener);
    }

    return () => {
      for (const [event, handler] of handlers) {
        source.removeEventListener(event, handler as EventListener);
      }
      source.close();
    };
  }, [token, loadNotifications, addToast]);

  return { notifications, unreadCount, toasts, loadNotifications, markRead };
}
