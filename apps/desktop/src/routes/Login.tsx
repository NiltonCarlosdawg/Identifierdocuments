import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { api } from "../services/api";
import { syncService } from "../services/sync";
import { Eye, EyeOff, FileText, Lock, LogIn, Mail } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res: any = await api.post("/auth/login", { email, password });
      login(res.data.token, res.data.user);
      await syncService.setCredentials(res.data.token);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Credenciais inválidas");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-docid-background p-6 text-docid-text">
      <div className="pointer-events-none absolute left-[-20%] top-1/4 h-96 w-96 rounded-full bg-docid-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-1/4 right-[-20%] h-96 w-96 rounded-full bg-docid-secondary/10 blur-3xl" />

      <div className="docid-panel relative z-10 w-full max-w-[400px] p-8 shadow-2xl shadow-black/20">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-7 w-7 text-docid-primary-soft" />
            <h1 className="text-xl font-bold text-docid-primary-soft">DocID</h1>
          </div>
          <p className="text-sm text-docid-muted">Gestão Documental Empresarial</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">E-mail Corporativo</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="docid-input w-full pl-10"
                placeholder="nome@empresa.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-docid-muted">Palavra-passe</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-docid-outline" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="docid-input w-full pl-10 pr-10"
                placeholder="••••••••"
                required
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-docid-outline transition hover:text-docid-text">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-docid-muted">
              <input type="checkbox" className="rounded border-docid-border bg-docid-surface-low text-docid-primary focus:ring-docid-primary" />
              Lembrar-me
            </label>
            <button type="button" className="text-docid-primary-soft hover:underline">Esqueceu a senha?</button>
          </div>

          {error && <p className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="docid-button-primary w-full py-3"
          >
            {loading ? "A entrar..." : "Entrar"} <LogIn className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-8 border-t border-docid-border pt-6 text-center">
          <p className="mb-3 text-sm text-docid-muted">Problemas no acesso?</p>
          <button type="button" className="docid-button-secondary" onClick={() => navigate("/onboarding")}>Criar organização</button>
        </div>

        <p className="mt-8 text-center text-xs uppercase tracking-wider text-docid-outline">
          © 2026 <span className="font-semibold text-docid-muted">VERANO Labs</span> · Luanda, Angola
        </p>
      </div>
    </div>
  );
}
