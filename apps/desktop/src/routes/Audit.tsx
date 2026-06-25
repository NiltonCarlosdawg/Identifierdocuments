import { useEffect, useState } from "react";
import { api } from "../services/api";
import { AlertTriangle, CheckCircle, Clock, Search, ShieldAlert } from "lucide-react";
import { EmptyState, PageHeader, Pagination, StatusChip } from "../components/docid-ui";

function severityTone(severity: string) {
  if (severity === "success") return "success" as const;
  if (severity === "warning") return "warning" as const;
  if (severity === "error") return "error" as const;
  return "info" as const;
}

export default function Audit() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("");

  useEffect(() => {
    api.get<any>("/audit").then((res) => {
      setEvents(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {
      setEvents([]);
    }).finally(() => setLoading(false));
  }, []);

  const filtered = events.filter((event) => {
    const haystack = `${event.actor || event.user?.fullName || ""} ${event.action || event.event || ""} ${event.entity || event.resource || ""}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (!severity || event.severity === severity);
  });

  return (
    <div>
      <PageHeader
        title="Auditoria de Sistema"
        description="Registo operacional para conformidade, segurança e rastreabilidade."
      />

      <section className="docid-panel mb-6 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="docid-input w-full pl-10"
              placeholder="Pesquisar no registo de auditoria..."
            />
          </div>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="docid-input">
            <option value="">Todas severidades</option>
            <option value="success">Sucesso</option>
            <option value="warning">Aviso</option>
            <option value="error">Erro</option>
            <option value="info">Info</option>
          </select>
          <select className="docid-input">
            <option>Últimas 24h</option>
            <option>Últimos 7 dias</option>
            <option>Último mês</option>
          </select>
        </div>
      </section>

      <section className="docid-panel overflow-hidden">
        <table className="docid-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Utilizador</th>
              <th>Acção</th>
              <th>Entidade</th>
              <th>IP / Origem</th>
              <th>Severidade</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-docid-muted">A carregar...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-docid-muted">Nenhum evento de auditoria encontrado.</td>
              </tr>
            ) : (
              filtered.map((event) => (
                <tr key={event.id}>
                  <td className="font-mono text-docid-muted">{event.createdAt ? new Date(event.createdAt).toLocaleString("pt-AO") : "—"}</td>
                  <td>{event.actor || event.user?.fullName || "Sistema"}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      {event.severity === "warning" ? <AlertTriangle className="h-4 w-4 text-docid-tertiary" /> : event.severity === "success" ? <CheckCircle className="h-4 w-4 text-docid-secondary" /> : <Clock className="h-4 w-4 text-docid-primary-soft" />}
                      {event.action || event.event || "—"}
                    </div>
                  </td>
                  <td className="font-mono text-docid-primary-soft">{event.entity || event.resource || "—"}</td>
                  <td>{event.ip || event.origin || "—"}</td>
                  <td><StatusChip tone={severityTone(event.severity || "info")}>{event.severity || "info"}</StatusChip></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {filtered.length > 0 && <Pagination totalLabel={`A mostrar ${filtered.length} evento${filtered.length !== 1 ? "s" : ""}`} />}
      </section>
    </div>
  );
}
