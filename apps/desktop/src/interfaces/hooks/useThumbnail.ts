import { useEffect, useState } from "react";
import { api } from "../../infrastructure/di/container";
import { mapError } from "../../shared/errors/mapError";

// A URL absoluta do thumbnail na listagem não leva o Bearer — buscar sempre via api.getBlob.
export function useThumbnail(documentId: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null); setError("");
    api.getBlob(`/documents/${encodeURIComponent(documentId)}/thumbnail`)
      .then(blob => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => { if (!cancelled) setError(mapError(err, "Miniatura indisponível.")); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId]);

  return { url, error };
}
