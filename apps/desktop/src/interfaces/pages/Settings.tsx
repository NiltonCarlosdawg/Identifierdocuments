import { useState } from "react";
import { useAppConfigStore } from "../stores/configStore";
import { PageHeader } from "../components/docid-ui";
import { Server, Sun, Moon, Save, RotateCcw } from "lucide-react";

export default function Settings() {
  const [tab, setTab] = useState<"server" | "appearance">("server");

  return (
    <div>
      <PageHeader title="Configurações" description="Gerir definições do servidor e preferências da aplicação" />
      <div className="mb-4 flex gap-2">
        <button onClick={() => setTab("server")} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "server" ? "bg-docid-primary text-white" : "border border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>Servidor</button>
        <button onClick={() => setTab("appearance")} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "appearance" ? "bg-docid-primary text-white" : "border border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>Aparência</button>
      </div>
      {tab === "server" ? <ServerTab /> : <AppearanceTab />}
    </div>
  );
}

function ServerTab() {
  const apiBaseUrl = useAppConfigStore(s => s.apiBaseUrl);
  const setApiBaseUrl = useAppConfigStore(s => s.setApiBaseUrl);
  const resetApiBaseUrl = useAppConfigStore(s => s.resetApiBaseUrl);
  const [input, setInput] = useState(apiBaseUrl);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  const handleSave = () => {
    setSaveError("");
    setApiBaseUrl(input);
    const actualUrl = useAppConfigStore.getState().apiBaseUrl;
    if (actualUrl === input) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setSaveError("HTTP só é permitido para localhost — use HTTPS para servidores remotos.");
    }
  };

  const isValid = (() => {
    const trimmed = input.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("https://") && trimmed.length > 8) return true;
    if (trimmed.startsWith("http://")) {
      const host = trimmed.replace("http://", "").split("/")[0].split(":")[0];
      return host === "localhost" || host === "127.0.0.1";
    }
    return false;
  })();

  return (
    <div className="docid-panel p-6 max-w-xl space-y-5">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-docid-muted">URL da API</label>
        <input value={input} onChange={e => setInput(e.target.value)} className="docid-input w-full font-mono text-sm" placeholder="http://localhost:3000" />
        {saveError && <p className="mt-1 text-xs text-docid-error">{saveError}</p>}
        <p className="mt-1 text-xs text-docid-muted">URL actual: <span className="font-mono text-docid-text">{apiBaseUrl}</span></p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={!isValid || input === apiBaseUrl} className="docid-button-primary"><Save className="h-4 w-4" /> Guardar</button>
        <button onClick={() => { resetApiBaseUrl(); setInput(useAppConfigStore.getState().apiBaseUrl); }} className="docid-button-secondary"><RotateCcw className="h-4 w-4" /> Restaurar predefinição</button>
        {saved && <span className="text-sm text-docid-secondary">Guardado!</span>}
      </div>
    </div>
  );
}

function AppearanceTab() {
  const theme = useAppConfigStore(s => s.theme);
  const setTheme = useAppConfigStore(s => s.setTheme);
  const isDark = theme === "dark";

  return (
    <div className="docid-panel p-6 max-w-xl space-y-5">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-docid-muted">Tema</label>
        <div className="flex gap-3">
          <button onClick={() => setTheme("light")} className={`flex flex-1 items-center gap-3 rounded-lg border p-4 text-sm font-medium transition ${!isDark ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>
            <Sun className="h-5 w-5" /> Claro
          </button>
          <button onClick={() => setTheme("dark")} className={`flex flex-1 items-center gap-3 rounded-lg border p-4 text-sm font-medium transition ${isDark ? "border-docid-primary bg-docid-primary/10 text-docid-primary-soft" : "border-docid-border text-docid-muted hover:bg-docid-surface-high"}`}>
            <Moon className="h-5 w-5" /> Escuro
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-docid-border bg-docid-surface-low p-4">
        <p className="text-xs text-docid-muted mb-2">Pré-visualização</p>
        <div className={`rounded-lg border p-4 ${isDark ? "border-[#434655] bg-[#1e1f26] text-[#e2e2eb]" : "border-[#ced4da] bg-white text-[#212529]"}`}>
          <p className="text-sm font-semibold">Texto de exemplo</p>
          <p className={`mt-1 text-xs ${isDark ? "text-[#c3c6d7]" : "text-[#6c757d]"}`}>Este é um preview do tema {isDark ? "escuro" : "claro"}.</p>
        </div>
      </div>
    </div>
  );
}
