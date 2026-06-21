import { useEffect, useState } from "react";
import { api } from "../services/api";
import { FileText, Fingerprint, Ban, AlertTriangle } from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    api.get<any>("/stats").then((res) => setStats(res.data)).catch(() => {});
  }, []);

  const cards = [
    { label: "Total Documentos", value: stats?.documents?.total ?? "—", icon: FileText, color: "bg-blue-500" },
    { label: "Identificadores", value: stats?.identifiers?.total ?? "—", icon: Fingerprint, color: "bg-green-500" },
    { label: "Falhas Verificação", value: stats?.documents?.verificationFailures ?? "—", icon: AlertTriangle, color: "bg-yellow-500" },
    { label: "Cancelados", value: stats?.identifiers?.byStatus?.cancelled ?? "—", icon: Ban, color: "bg-red-500" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl bg-white p-5 shadow-sm border border-gray-100 flex items-center gap-4">
            <div className={`rounded-lg ${color} p-3`}>
              <Icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm text-gray-500">{label}</p>
              <p className="text-xl font-bold text-gray-900">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {stats?.identifiers?.byCategory && (
        <div className="mt-8 rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Por Categoria</h2>
          <div className="space-y-2">
            {stats.identifiers.byCategory.map((c: any) => (
              <div key={c.category} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{c.category}</span>
                <span className="font-medium">{c.cnt}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
