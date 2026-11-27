import { useState } from "react";
import { api } from "../../../infrastructure/di/container";
import { Modal } from "../docid-ui";
import { mapError } from "../../../shared/errors/mapError";

export default function RequestAccessModal({ identifier, onClose, onDone }: { identifier: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      await api.post(`/documents/${identifier}/request-access`, { reason: reason.trim() || undefined });
      setSuccess(true);
    } catch (err: any) {
      setError(mapError(err, "Não foi possível enviar o pedido de acesso."));
    } finally { setLoading(false); }
  };

  return (
    <Modal title="Pedir Acesso ao Documento" onClose={onClose} footer={
      success
        ? <button onClick={onDone} className="docid-button-primary">Fechar</button>
        : <><button onClick={onClose} className="docid-button-secondary">Cancelar</button><button onClick={handleSubmit} disabled={loading} className="docid-button-primary">{loading ? "A enviar..." : "Enviar Pedido"}</button></>
    }>
      <div className="space-y-4">
        <p className="font-mono text-xs text-docid-muted">{identifier}</p>
        {error && <div className="rounded-lg border border-docid-error/30 bg-docid-error/10 p-3 text-sm text-docid-error">{error}</div>}
        {success ? (
          <div className="rounded-lg border border-docid-secondary/30 bg-docid-secondary/10 p-3 text-sm text-docid-secondary">
            Pedido de acesso enviado. O supervisor do sector emitente será notificado.
          </div>
        ) : (
          <>
            <p className="text-sm text-docid-muted">Solicite acesso ao supervisor do sector que emitiu este documento. Pode indicar o motivo do pedido.</p>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="docid-input w-full" placeholder="Motivo do pedido (opcional)..." />
          </>
        )}
      </div>
    </Modal>
  );
}
