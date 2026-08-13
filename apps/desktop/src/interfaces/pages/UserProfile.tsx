import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../infrastructure/di/container";
import { PageHeader, StatusChip, OfflineNotice } from "../components/docid-ui";
import { useOfflineCache } from "../hooks/useOfflineCache";
import { useAuthStore } from "../stores/authStore";
import { ArrowLeft, Mail, Shield, Building2 } from "lucide-react";

interface UserProfileData {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  sectorId: string | null;
  sectorName: string | null;
  roles: { id: string; name: string }[];
  createdAt: string;
}

/** Perfil de outro utilizador (não o próprio) — leitura via GET /users/:id. */
export default function UserProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const me = useAuthStore(s => s.user);
  const [profile, setProfile] = useState<UserProfileData | null>(null);

  const { loading, error, isStale, cachedAt, refresh } = useOfflineCache<{ data: UserProfileData }>({
    endpoint: `/users/${id}`,
    enabled: !!id,
    fetcher: async () => {
      const res = await api.get<{ data: UserProfileData }>(`/users/${id}`);
      return { data: res.data };
    },
    onData: (result) => setProfile(result.data),
  });

  useEffect(() => {
    if (me?.id && id && me.id === id) {
      navigate("/perfil", { replace: true });
    }
  }, [me?.id, id, navigate]);

  if (!id) {
    return <p className="text-sm text-docid-error">Utilizador inválido.</p>;
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Perfil do utilizador"
        description="Consulta de dados de um membro da organização"
        actions={
          <Link to="/utilizadores" className="docid-button-secondary">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
        }
      />
      {error && <div className="mb-4 rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
      {isStale && <OfflineNotice cachedAt={cachedAt} onRetry={refresh} />}

      {loading && !profile ? (
        <div className="flex items-center justify-center py-16 text-sm text-docid-muted">A carregar...</div>
      ) : !profile ? (
        <div className="docid-panel p-6 text-sm text-docid-muted">Utilizador não encontrado.</div>
      ) : (
        <div className="docid-panel p-6 space-y-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-docid-primary/15 text-2xl font-bold text-docid-primary-soft">
              {(profile.fullName || "?").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-lg font-semibold">{profile.fullName}</p>
              <p className="flex items-center gap-1.5 text-sm text-docid-muted"><Mail className="h-3.5 w-3.5" />{profile.email}</p>
            </div>
            <div className="ml-auto">
              <StatusChip tone={profile.isActive ? "success" : "error"}>{profile.isActive ? "Activo" : "Inactivo"}</StatusChip>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-docid-muted flex items-center gap-1"><Building2 className="h-3 w-3" /> Sector</p>
              <p className="font-medium">{profile.sectorName || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-docid-muted">Criado em</p>
              <p className="font-medium">{new Date(profile.createdAt).toLocaleString("pt-AO")}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-docid-muted flex items-center gap-1 mb-1.5"><Shield className="h-3 w-3" /> Roles</p>
              <div className="flex flex-wrap gap-1">
                {(profile.roles || []).length === 0 && <span className="text-docid-muted">—</span>}
                {(profile.roles || []).map(r => (
                  <span key={r.id} className="rounded-full bg-docid-surface-high px-2 py-0.5 text-[10px] font-medium text-docid-muted">{r.name}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
