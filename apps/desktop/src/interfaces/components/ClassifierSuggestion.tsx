import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../infrastructure/di/container";
import { useClassifier } from "../hooks/useClassifier";
import type { ClassifierResult } from "../hooks/useClassifier";
import { Sparkles, Check, X, RefreshCw, Brain } from "lucide-react";

interface Category { id: string; name: string; group: string; prefix: string; }

interface Props {
  text: string;
  filename?: string;
  onSelect: (categoryId: string) => void;
  onCancel?: () => void;
  onClassified?: (result: ClassifierResult) => void;
}

export default function ClassifierSuggestion({ text, filename, onSelect, onCancel, onClassified }: Props) {
  const { data, loading, error, classify, reset } = useClassifier();
  const [mode, setMode] = useState<"suggesting" | "manual">("suggesting");
  const [categories, setCategories] = useState<Category[]>([]);
  const [manualId, setManualId] = useState("");
  const classifiedRef = useRef(false);

  useEffect(() => { classify(text, filename); }, []);

  useEffect(() => {
    if (data) {
      if (!classifiedRef.current) {
        classifiedRef.current = true;
        onClassified?.(data);
      }
    } else {
      classifiedRef.current = false;
    }
  }, [data, onClassified]);

  useEffect(() => {
    api.get<{ data: { groups: Record<string, Category[]> } }>("/categories")
      .then(r => { const all: Category[] = []; for (const g of Object.values(r.data?.groups || {})) all.push(...g); setCategories(all); })
      .catch(() => {});
  }, []);

  const handleRetry = useCallback(() => { classify(text, filename); }, [classify, text, filename]);

  const groups = categories.reduce<Record<string, Category[]>>((acc, c) => { (acc[c.group] = acc[c.group] || []).push(c); return acc; }, {});

  if (loading) return (
    <div className="rounded-lg border border-docid-border bg-docid-surface-low p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm text-docid-muted"><Brain className="h-4 w-4 animate-pulse text-docid-primary-soft" /> A analisar documento...</div>
      <div className="h-2 w-full rounded-full bg-docid-surface-high overflow-hidden"><div className="h-full w-1/2 animate-pulse rounded-full bg-docid-primary-soft/40" /></div>
    </div>
  );

  if (error) return (
    <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm text-docid-error"><X className="h-4 w-4" /> Classificador indisponível</div>
      <p className="text-xs text-docid-muted">{error}</p>
      <div className="flex gap-2">
        <button onClick={handleRetry} className="docid-button-secondary text-xs py-1.5"><RefreshCw className="h-3 w-3" /> Tentar novamente</button>
        <button onClick={() => setMode("manual")} className="docid-button-secondary text-xs py-1.5">Seleccionar manualmente</button>
      </div>
    </div>
  );

  if (!data) return null;

  if (data.categoryId === "UNKNOWN" || mode === "manual") {
    const selectedManual = mode === "manual";
    return (
      <div className="rounded-lg border border-docid-border bg-docid-surface-low p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-docid-text">
          <Sparkles className="h-4 w-4 text-docid-tertiary" />
          {selectedManual ? "Seleccionar categoria manualmente" : "Categoria não identificada"}
        </div>
        {!selectedManual && <p className="text-xs text-docid-muted">{data.reasoning}</p>}
        <div>
          <select value={manualId} onChange={e => setManualId(e.target.value)} className="docid-input w-full">
            <option value="">Seleccionar categoria...</option>
            {Object.entries(groups).map(([group, cats]) => (
              <optgroup key={group} label={group}>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name} ({c.prefix})</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          {onCancel && <button onClick={onCancel} className="docid-button-secondary flex-1 text-xs py-1.5">Cancelar</button>}
          <button onClick={() => manualId && onSelect(manualId)} disabled={!manualId} className="docid-button-primary flex-1 text-xs py-1.5">Confirmar</button>
        </div>
      </div>
    );
  }

  const confidencePct = Math.round(data.confidence * 100);
  const confidenceTone = confidencePct >= 80 ? "success" : confidencePct >= 50 ? "warning" : "neutral";

  return (
    <div className="rounded-lg border border-docid-primary/20 bg-docid-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-docid-text">
        <Sparkles className="h-4 w-4 text-docid-primary-soft" /> Sugestão do classificador
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base font-semibold text-docid-text">{data.categoryName || data.categoryId}</p>
          {data.group && <p className="text-xs text-docid-muted">{data.group}</p>}
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${
          confidenceTone === "success" ? "border-docid-secondary/30 bg-docid-secondary/10 text-docid-secondary" :
          confidenceTone === "warning" ? "border-docid-tertiary/30 bg-docid-tertiary/10 text-docid-tertiary" :
          "border-docid-border bg-docid-surface-high text-docid-muted"
        }`}>{confidencePct}%</div>
      </div>
      {data.reasoning && <p className="text-xs text-docid-muted italic">"{data.reasoning}"</p>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-docid-surface-high">
        <div className={`h-full rounded-full transition-all duration-500 ${
          confidenceTone === "success" ? "bg-docid-secondary" :
          confidenceTone === "warning" ? "bg-docid-tertiary" : "bg-docid-muted"
        }`} style={{ width: `${confidencePct}%` }} />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={() => onSelect(data.categoryId)} className="docid-button-primary flex-1 text-xs py-1.5"><Check className="h-3 w-3" /> Aceitar sugestão</button>
        <button onClick={() => setMode("manual")} className="docid-button-secondary flex-1 text-xs py-1.5"><X className="h-3 w-3" /> Rejeitar</button>
      </div>
    </div>
  );
}
