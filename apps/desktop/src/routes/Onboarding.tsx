import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: "", adminEmail: "", adminPassword: "", identifierPrefix: "VL" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/tenants", form);
      const loginRes: any = await api.post("/auth/login", {
        email: form.adminEmail,
        password: form.adminPassword,
      });
      const { useAuthStore } = await import("../stores/auth");
      const { syncService } = await import("../services/sync");
      useAuthStore.getState().login(loginRes.data.token, loginRes.data.user);
      await syncService.setCredentials(loginRes.data.token);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Erro ao criar organização");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-verano-900 to-verano-700">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-verano-800">DocID</h1>
          <p className="mt-1 text-sm text-gray-500">Criar nova organização</p>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Passo 1 de 2 — Dados da empresa</p>
            <div>
              <label className="block text-sm font-medium text-gray-700">Nome da organização</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-verano-500 focus:outline-none focus:ring-1 focus:ring-verano-500"
                placeholder="Ex: Verano Labs" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Prefixo do identificador</label>
              <input value={form.identifierPrefix} onChange={(e) => setForm({ ...form, identifierPrefix: e.target.value.toUpperCase() })}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-verano-500 focus:outline-none focus:ring-1 focus:ring-verano-500"
                placeholder="VL" maxLength={5} />
              <p className="mt-1 text-xs text-gray-400">Ex: VL → VL-PROP-2026-0622-001</p>
            </div>
            <button onClick={() => setStep(2)} disabled={!form.name}
              className="w-full rounded-lg bg-verano-600 px-4 py-2 text-white font-medium hover:bg-verano-700 disabled:opacity-50 transition-colors">
              Continuar
            </button>
          </div>
        )}

        {step === 2 && (
          <form onSubmit={create} className="space-y-4">
            <p className="text-sm text-gray-600">Passo 2 de 2 — Administrador</p>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email do administrador</label>
              <input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-verano-500 focus:outline-none focus:ring-1 focus:ring-verano-500"
                placeholder="admin@verano.ao" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-verano-500 focus:outline-none focus:ring-1 focus:ring-verano-500"
                placeholder="mín. 6 caracteres" minLength={6} required />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={() => setStep(1)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Voltar
              </button>
              <button type="submit" disabled={loading || !form.adminEmail || !form.adminPassword}
                className="flex-1 rounded-lg bg-verano-600 px-4 py-2 text-white font-medium hover:bg-verano-700 disabled:opacity-50 transition-colors">
                {loading ? "A criar..." : "Criar organização"}
              </button>
            </div>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          Já tem uma conta?{' '}
          <button onClick={() => navigate("/login")} className="text-verano-600 hover:underline">Entrar</button>
        </p>
      </div>
    </div>
  );
}
