import { useEffect, useState, useCallback, useRef } from "react";
import { useAuthStore } from "../stores/authStore";
import { api } from "../../infrastructure/di/container";
import type { AppNotification } from "../../domain/entities/Notification";

export function useNotifications() {
  const token = useAuthStore(s => s.token);
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
    const messages: Record<string, string> = {
      "approval:pending": "Nova aprovação pendente", "approval:approved": "Documento aprovado",
      "approval:rejected": "Documento rejeitado", "document:shared": "Documento partilhado consigo",
      "sync:complete": "Sincronização concluída",
    };
    const id = crypto.randomUUID();
    const identifier = payload.identifier as string | undefined;
    const message = identifier ? `${messages[type] || type}: ${identifier}` : messages[type] || type;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  useEffect(() => {
    if (!token) return;
    loadNotifications();
    intervalRef.current = setInterval(loadNotifications, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [token, loadNotifications]);

  return { notifications, unreadCount, toasts, loadNotifications, markRead };
}
