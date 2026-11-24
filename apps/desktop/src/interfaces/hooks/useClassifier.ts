import { useState } from "react";
import { api } from "../../infrastructure/di/container";
import { mapError } from "../../shared/errors/mapError";

export interface ClassifierResult {
  categoryId: string;
  categoryName: string | null;
  group: string | null;
  confidence: number;
  reasoning: string;
}

export function useClassifier() {
  const [data, setData] = useState<ClassifierResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const classify = async (text: string, filename?: string) => {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await api.post<{ data: ClassifierResult }>("/classifier/suggest", { text, filename });
      setData(res.data);
    } catch (err: any) {
      setError(mapError(err, "Não foi possível analisar o documento."));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setData(null); setError(""); setLoading(false); };

  return { data, loading, error, classify, reset };
}
