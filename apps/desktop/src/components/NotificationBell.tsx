import { useState } from "react";
import { Bell, X } from "lucide-react";
import { useNotifications } from "../hooks/useNotifications";

export default function NotificationBell() {
  const { notifications, unreadCount, toasts, markRead, loadNotifications } = useNotifications();
  const [open, setOpen] = useState(false);

  const typeLabel: Record<string, string> = {
    "approval:pending": "Aprovação pendente",
    "approval:approved": "Aprovado",
    "approval:rejected": "Rejeitado",
    "document:shared": "Documento partilhado",
  };

  return (
    <>
      {toasts.length > 0 && (
        <div className="fixed right-6 top-16 z-50 space-y-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="rounded-lg bg-docid-primary px-4 py-3 text-sm text-white shadow-lg animate-in fade-in slide-in-from-right"
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <button
          onClick={() => { setOpen(!open); if (!open) loadNotifications(); }}
          className="relative rounded-lg p-2 hover:bg-docid-surface-low transition-colors"
        >
          <Bell className="h-4 w-4 text-docid-muted" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unreadCount}
            </span>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-2 w-80 docid-panel shadow-xl">
              <div className="flex items-center justify-between border-b border-docid-border px-4 py-3">
                <h3 className="text-sm font-semibold text-docid-text">Notificações</h3>
                <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-docid-surface-low text-docid-muted">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-docid-muted">Sem notificações.</p>
                )}
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className={`w-full border-b border-docid-border px-4 py-3 text-left text-sm hover:bg-docid-surface-low ${!n.isRead ? "bg-docid-primary/10" : ""}`}
                  >
                    <p className="font-medium text-docid-text">{typeLabel[n.type] || n.type}</p>
                    {typeof n.payload.identifier === "string" && (
                      <p className="font-mono text-xs text-docid-muted">{n.payload.identifier}</p>
                    )}
                    <p className="mt-1 text-xs text-docid-outline">
                      {new Date(n.createdAt).toLocaleString("pt-AO")}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
