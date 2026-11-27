import { useEffect, useRef, useState } from "react";
import { api, sync } from "../../../infrastructure/di/container";
import { StatusChip } from "../docid-ui";
import { mapError, friendlyStatus, friendlyMime } from "../../../shared/errors/mapError";
import { useAuthStore } from "../../stores/authStore";
import { usePrinterStore } from "../../stores/printerStore";
import { useThumbnail } from "../../hooks/useThumbnail";
import ShareDocumentModal from "../ShareDocumentModal";
import DocumentSharesPanel from "../DocumentSharesPanel";
import DocumentAccessRequestsPanel from "../DocumentAccessRequestsPanel";
import RequestAccessModal from "./RequestAccessModal";
import { DOCUMENT_PRESET_TAGS, formatSize, type DocDetail, type DocRow } from "./types";
import {
  X, ExternalLink, Share2, MoreHorizontal, Printer, History, Paperclip, Copy, Lock, Download, FileText, Check, Tag,
} from "lucide-react";

type Tab = "detalhes" | "versoes" | "anexos" | "partilhas" | "pedidos" | "actividade";

interface Props {
  row: DocRow;
  onClose: () => void;
  /** Algo mudou (etiquetas, versão, anexo, partilha): recarregar a lista. */
  onChanged: () => void;
  onOpen: (row: DocRow) => Promise<void>;
}

const STATUS_TONE = (s: string) => (s === "active" || s === "attached" ? "success" : s === "cancelled" ? "error" : "neutral");

/** Painel lateral com a pré-visualização, as acções e os separadores do documento seleccionado. */
export default function DocumentPanel({ row, onClose, onChanged, onOpen }: Props) {
  const user = useAuthStore(s => s.user);
  const isTauri = sync.isAvailable();
  const [tab, setTab] = useState<Tab>("detalhes");
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [offline, setOffline] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showRequestAccess, setShowRequestAccess] = useState(false);
  const [sharesKey, setSharesKey] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const { url: thumbnailUrl } = useThumbnail(row.id);
  const selectedPrinter = usePrinterStore(s => s.selectedPrinter);
  const loadPrinters = usePrinterStore(s => s.loadPrinters);
  const printFile = usePrinterStore(s => s.printFile);

  const identCode = row.identifier?.identifier || "";
  const isOwner = !!user && (row.uploadedById ? row.uploadedById === user.id : row.uploadedBy === user.fullName);
  const isOtherSector = row.identifier?.visibility === "sector_only" && row.identifier?.sectorId != null && row.identifier.sectorId !== user?.sectorId;
  const needsAccess = !isOwner && (isOtherSector || !!detail?.restricted);
  const title = row.label?.trim() || row.filename || identCode || "Documento";

  const loadDetail = async () => {
    try {
      const res = await api.get<{ data: DocDetail }>(`/documents/${row.id}`);
      setDetail(res.data);
    } catch (err) {
      setError(mapError(err, "Não foi possível carregar os detalhes."));
    }
  };

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setTab("detalhes"); setDetail(null); setError(""); setNotice(""); setPreviewUrl(null); setMenuOpen(false);
    void loadDetail();
    if (isTauri) {
      loadPrinters();
      sync.isDocumentCached(row.id).then(v => { if (!cancelled) setOffline(v); }).catch(() => {});
    } else setOffline(null);
    const isPdf = (row.mimeType || "").includes("pdf") || row.filename?.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      api.getBlob(`/documents/${row.id}/download`).then(blob => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      }).catch(() => {});
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  // Fechar o menu "Mais" ao clicar fora ou com Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    // stopPropagation: o Esc que fecha o menu não pode chegar à página (que fecharia o painel).
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMenuOpen(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menuOpen]);

  const run = async (name: string, fn: () => Promise<void>, failMsg: string) => {
    setBusy(name); setError(""); setNotice(""); setMenuOpen(false);
    try { await fn(); } catch (err) { setError(mapError(err, failMsg)); } finally { setBusy(""); }
  };

  const pickFile = async (): Promise<string | File | null> => {
    if (isTauri) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: false, filters: [{ name: "Documentos", extensions: ["pdf", "txt", "md", "csv", "docx"] }] });
      return (selected as string) || null;
    }
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
  };

  const newVersion = (documentId: string) => run("versao", async () => {
    const picked = await pickFile();
    if (!picked) return;
    if (typeof picked === "string") {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("attach_document_native", { path: picked, mode: "version", documentId, uploadSource: "manual" });
    } else {
      const fd = new FormData();
      fd.append("file", picked);
      await api.post(`/documents/${documentId}/versions`, fd);
    }
    await loadDetail(); onChanged();
    setNotice("Nova versão guardada."); setTab("versoes");
  }, "Não foi possível criar a nova versão.");

  const addAttachment = () => run("anexo", async () => {
    if (!identCode) throw new Error("Identificador em falta.");
    const picked = await pickFile();
    if (!picked) return;
    if (typeof picked === "string") {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("attach_document_native", { path: picked, identifier: identCode, mode: "attachment", uploadSource: "manual" });
    } else {
      const fd = new FormData();
      fd.append("identifier", identCode);
      fd.append("file", picked);
      await api.post("/documents/attachments", fd);
    }
    await loadDetail(); onChanged();
    setNotice("Anexo adicionado."); setTab("anexos");
  }, "Não foi possível adicionar o anexo.");

  const print = () => run("imprimir", async () => {
    const path = await sync.downloadOffline(row.id, row.filename);
    if (!path) throw new Error("Documento não disponível para impressão. Descarregue primeiro.");
    await printFile(path);
    setNotice("Enviado para a impressora.");
  }, "Não foi possível imprimir.");

  const copyIdentifier = () => run("copiar", async () => {
    await navigator.clipboard.writeText(identCode);
    setNotice("Identificador copiado.");
  }, "Não foi possível copiar.");

  const downloadBlob = (path: string, filename: string) => run("descarregar", async () => {
    const blob = await api.getBlob(path);
    if (!blob) throw new Error("O ficheiro está vazio.");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename || "documento"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, "Não foi possível descarregar o ficheiro.");

  const versions = detail?.versions || [];
  const attachments = detail?.attachments || [];
  const tabs: Array<[Tab, string, number | null]> = [
    ["detalhes", "Detalhes", null],
    ["versoes", "Versões", versions.length || null],
    ["anexos", "Anexos", attachments.length || null],
    ["partilhas", "Partilhas", null],
    ["pedidos", "Pedidos", null],
    ["actividade", "Actividade", null],
  ];

  return (
    <aside className="docid-panel flex h-full min-h-0 flex-col overflow-hidden" data-testid="document-panel" aria-label="Detalhe do documento">
      {/* Cabeçalho */}
      <div className="border-b border-docid-border px-5 pb-4 pt-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {row.identifier?.categoryName && <span className="text-[11px] font-semibold uppercase tracking-wide text-docid-primary-soft">{row.identifier.categoryName}</span>}
            <StatusChip tone={STATUS_TONE(row.status)}>{friendlyStatus(row.status)}</StatusChip>
            {offline !== null && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${offline ? "bg-docid-secondary/10 text-docid-secondary" : "bg-docid-surface-high text-docid-muted"}`}>
                {offline ? "Disponível offline" : "Só online"}
              </span>
            )}
          </div>
          <button onClick={onClose} aria-label="Fechar detalhe" className="rounded-lg p-1.5 text-docid-muted transition hover:bg-docid-surface-high hover:text-docid-text"><X className="h-4 w-4" /></button>
        </div>
        <h2 className="break-words text-base font-semibold leading-snug text-docid-text" data-testid="document-panel-title">{title}</h2>
        {identCode && (
          <button type="button" onClick={copyIdentifier} title="Copiar identificador" className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-docid-muted hover:text-docid-text">
            {identCode} {busy === "copiar" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        )}

        {/* Acções: as duas principais à vista, o resto em "Mais". */}
        <div className="mt-4 flex items-center gap-2">
          {needsAccess ? (
            <button onClick={() => setShowRequestAccess(true)} className="docid-button-primary"><Lock className="h-4 w-4" /> Pedir acesso</button>
          ) : (
            <button onClick={() => run("abrir", () => onOpen(row), "Não foi possível abrir o documento.")} disabled={!!busy} className="docid-button-primary" data-testid="document-open">
              <ExternalLink className="h-4 w-4" /> {busy === "abrir" ? "A abrir..." : "Abrir"}
            </button>
          )}
          <button onClick={() => setShowShare(true)} className="docid-button-secondary" data-testid="document-share"><Share2 className="h-4 w-4" /> Partilhar</button>
          <div className="relative ml-auto" ref={menuRef}>
            <button onClick={() => setMenuOpen(o => !o)} aria-haspopup="menu" aria-expanded={menuOpen} className="docid-button-secondary px-2.5" title="Mais acções" data-testid="document-more">
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-docid-border bg-docid-surface py-1 shadow-xl">
                <MenuItem icon={History} onClick={() => newVersion(row.id)}>Carregar nova versão</MenuItem>
                <MenuItem icon={Paperclip} onClick={addAttachment}>Adicionar anexo</MenuItem>
                {isTauri && <MenuItem icon={Printer} onClick={print} disabled={!selectedPrinter} hint={!selectedPrinter ? "Escolha uma impressora em Configurações" : undefined}>Imprimir</MenuItem>}
                {identCode && <MenuItem icon={Copy} onClick={copyIdentifier}>Copiar identificador</MenuItem>}
                {needsAccess && <MenuItem icon={ExternalLink} onClick={() => run("abrir", () => onOpen(row), "Não foi possível abrir o documento.")}>Tentar abrir</MenuItem>}
              </div>
            )}
          </div>
        </div>
        {busy && busy !== "abrir" && busy !== "copiar" && <p className="mt-2 text-xs text-docid-muted">A processar...</p>}
        {notice && <p className="mt-2 text-xs text-docid-secondary" role="status">{notice}</p>}
        {error && <p className="mt-2 text-xs text-docid-error" role="alert">{error}</p>}
      </div>

      {/* Separadores */}
      <div className="flex gap-1 overflow-x-auto border-b border-docid-border px-3" role="tablist">
        {tabs.map(([key, label, count]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`document-tab-${key}`}
            className={`relative shrink-0 px-2.5 py-2.5 text-xs font-medium transition ${tab === key ? "text-docid-text" : "text-docid-muted hover:text-docid-text"}`}>
            {label}{count ? <span className="ml-1 rounded-full bg-docid-surface-high px-1.5 text-[10px]">{count}</span> : null}
            {tab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-docid-primary" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "detalhes" && (
          <div className="space-y-5">
            <Preview previewUrl={previewUrl} thumbnailUrl={thumbnailUrl} mime={row.mimeType} filename={row.filename} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Field label="Ficheiro" wide>{row.filename || "—"}</Field>
              <Field label="Tamanho">{[formatSize(detail?.fileSize ?? row.fileSize), friendlyMime(row.mimeType)].filter(Boolean).join(" · ") || "—"}</Field>
              <Field label="Categoria">{row.identifier?.categoryName || "—"}</Field>
              <Field label="Carregado por">{row.uploadedBy || "—"}</Field>
              <Field label="Data">{new Date(row.createdAt).toLocaleString("pt-AO")}</Field>
              <Field label="Visibilidade">{row.identifier?.visibility === "sector_only" ? "Só o sector" : "Toda a organização"}</Field>
              {row.sharedWithMe && <Field label="Acesso">Partilhado consigo</Field>}
            </dl>
            <TagsEditor documentId={row.id} initial={detail?.tags ?? row.tags ?? []} onSaved={onChanged} />
          </div>
        )}

        {tab === "versoes" && (
          <ListSection empty="Só existe a versão original." items={versions.map(v => ({
            key: v.id,
            title: <>Versão {v.version}{v.isCurrent && <span className="ml-2 text-docid-secondary">actual</span>}</>,
            sub: `${v.filename} · ${new Date(v.createdAt).toLocaleString("pt-AO")}${v.uploadedBy ? ` · ${v.uploadedBy}` : ""}`,
            action: (
              <button title="Descarregar esta versão" className="rounded p-1 text-docid-muted hover:bg-docid-surface-high hover:text-docid-text"
                onClick={() => downloadBlob(v.isCurrent ? `/documents/${row.id}/download` : `/documents/${row.id}/versions/${v.version}/download`, v.filename)}>
                <Download className="h-4 w-4" />
              </button>
            ),
          }))} footer={<button onClick={() => newVersion(row.id)} disabled={!!busy} className="docid-button-secondary text-xs"><History className="h-3.5 w-3.5" /> Carregar nova versão</button>} />
        )}

        {tab === "anexos" && (
          <ListSection empty="Este documento não tem anexos." items={attachments.map(a => ({
            key: a.id,
            title: a.label || a.filename || "Anexo",
            sub: [formatSize(a.fileSize), new Date(a.createdAt).toLocaleDateString("pt-AO")].filter(Boolean).join(" · "),
            action: (
              <div className="flex gap-1">
                <button title="Nova versão do anexo" className="rounded p-1 text-docid-muted hover:bg-docid-surface-high hover:text-docid-text" onClick={() => newVersion(a.id)} disabled={!!busy}><History className="h-4 w-4" /></button>
                <button title="Descarregar" className="rounded p-1 text-docid-muted hover:bg-docid-surface-high hover:text-docid-text" onClick={() => downloadBlob(`/documents/${a.id}/download`, a.filename || a.label || "anexo")}><Download className="h-4 w-4" /></button>
              </div>
            ),
          }))} footer={<button onClick={addAttachment} disabled={!!busy} className="docid-button-secondary text-xs"><Paperclip className="h-3.5 w-3.5" /> Adicionar anexo</button>} />
        )}

        {tab === "partilhas" && identCode && (
          <div className="space-y-3">
            <button onClick={() => setShowShare(true)} className="docid-button-secondary text-xs"><Share2 className="h-3.5 w-3.5" /> Partilhar com um sector ou pessoa</button>
            <DocumentSharesPanel key={sharesKey} identifier={identCode} onChanged={onChanged} />
          </div>
        )}
        {tab === "pedidos" && identCode && <DocumentAccessRequestsPanel identifier={identCode} onChanged={onChanged} />}
        {tab === "actividade" && <ActivityList documentId={row.id} identifierId={row.identifier?.id} />}
      </div>

      {showShare && identCode && (
        <ShareDocumentModal identifier={identCode} onClose={() => setShowShare(false)}
          onShared={() => { setShowShare(false); setSharesKey(k => k + 1); setNotice("Documento partilhado."); onChanged(); }} />
      )}
      {showRequestAccess && identCode && (
        <RequestAccessModal identifier={identCode} onClose={() => setShowRequestAccess(false)} onDone={() => { setShowRequestAccess(false); onChanged(); }} />
      )}
    </aside>
  );
}

function MenuItem({ icon: Icon, children, onClick, disabled, hint }: { icon: typeof Copy; children: React.ReactNode; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button role="menuitem" onClick={onClick} disabled={disabled} title={hint}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-docid-text transition hover:bg-docid-surface-high disabled:cursor-not-allowed disabled:opacity-50">
      <Icon className="h-4 w-4 text-docid-muted" /> {children}
    </button>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="text-[11px] text-docid-muted">{label}</dt>
      <dd className="truncate font-medium text-docid-text">{children}</dd>
    </div>
  );
}

function Preview({ previewUrl, thumbnailUrl, mime, filename }: { previewUrl: string | null; thumbnailUrl: string | null; mime: string; filename: string }) {
  if (previewUrl) {
    return <iframe title="Pré-visualização" src={previewUrl} className="h-80 w-full rounded-lg border border-docid-border bg-docid-surface-low" />;
  }
  if (thumbnailUrl) {
    return <img src={thumbnailUrl} alt={`Miniatura de ${filename}`} className="max-h-64 w-full rounded-lg border border-docid-border bg-docid-surface-low object-contain" />;
  }
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-docid-border text-docid-muted">
      <FileText className="h-8 w-8" />
      <span className="text-xs">{friendlyMime(mime)} · sem pré-visualização</span>
    </div>
  );
}

function ListSection({ items, empty, footer }: { items: Array<{ key: string; title: React.ReactNode; sub: string; action: React.ReactNode }>; empty: string; footer?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      {items.length === 0 ? <p className="text-sm text-docid-muted">{empty}</p> : (
        <ul className="divide-y divide-docid-border rounded-lg border border-docid-border">
          {items.map(i => (
            <li key={i.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-docid-text">{i.title}</p>
                <p className="truncate text-[11px] text-docid-muted">{i.sub}</p>
              </div>
              {i.action}
            </li>
          ))}
        </ul>
      )}
      {footer}
    </div>
  );
}

function TagsEditor({ documentId, initial, onSaved }: { documentId: string; initial: string[]; onSaved: () => void }) {
  const [tags, setTags] = useState<string[]>(initial);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setTags(initial); }, [documentId, initial.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next: string[]) => {
    const before = tags;
    setTags(next); setSaving(true); setError("");
    try {
      const res = await api.patch<{ data: { tags: string[] } }>(`/documents/${documentId}/tags`, { tags: next });
      setTags(res.data.tags); onSaved();
    } catch (err) {
      setTags(before); setError(mapError(err, "Não foi possível guardar as etiquetas."));
    } finally { setSaving(false); }
  };
  const add = () => { const t = custom.trim(); if (!t || tags.includes(t)) return; setCustom(""); void save([...tags, t]); };
  const custom_ = tags.filter(t => !(DOCUMENT_PRESET_TAGS as readonly string[]).includes(t));

  return (
    <div data-testid="document-tags">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-docid-muted"><Tag className="h-3.5 w-3.5" /> Etiquetas</p>
      <div className="flex flex-wrap gap-1.5">
        {DOCUMENT_PRESET_TAGS.map(t => (
          <button key={t} type="button" disabled={saving} aria-pressed={tags.includes(t)} onClick={() => save(tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t])}
            className={`rounded-full px-2.5 py-1 text-[11px] transition ${tags.includes(t) ? "bg-docid-primary/20 text-docid-primary-soft" : "bg-docid-surface-high text-docid-muted hover:text-docid-text"}`}>{t}</button>
        ))}
        {custom_.map(t => (
          <button key={t} type="button" disabled={saving} onClick={() => save(tags.filter(x => x !== t))} title="Remover etiqueta"
            className="rounded-full bg-docid-primary/20 px-2.5 py-1 text-[11px] text-docid-primary-soft">{t} ×</button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          className="docid-input flex-1 text-xs" placeholder="Nova etiqueta…" disabled={saving} maxLength={40} />
        <button type="button" onClick={add} disabled={saving || !custom.trim()} className="docid-button-secondary text-xs">Adicionar</button>
      </div>
      {error && <p className="mt-1 text-xs text-docid-error">{error}</p>}
    </div>
  );
}

const ACTIVITY_LABELS: Record<string, string> = {
  ATTACH: "Documento associado", ATTACH_ATTACHMENT: "Anexo adicionado", VERSION: "Nova versão", ATTACH_FAILED: "Falha ao associar",
  SHARE: "Partilhado", REVOKE_SHARE: "Partilha revogada", REQUEST_ACCESS: "Pedido de acesso", CANCEL_ACCESS_REQUEST: "Pedido de acesso cancelado",
  ACCESS_APPROVED: "Acesso aprovado", ACCESS_DENIED: "Acesso negado", GENERATE: "Identificador gerado", CANCEL: "Identificador anulado",
  QUERY: "Consultado", DOWNLOAD_EMAIL_LINK: "Descarregado pelo link do e-mail", APPROVE: "Aprovação",
};

interface ActivityEvent { id: string; action: string; createdAt: string; userName: string | null }

function ActivityList({ documentId, identifierId }: { documentId: string; identifierId?: string }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setEvents(null); setError("");
    // Algumas acções ficam registadas no documento e outras no identificador: juntar as duas.
    const ids = [documentId, identifierId].filter(Boolean) as string[];
    Promise.all(ids.map(id => api.get<{ data: ActivityEvent[] }>(`/audit?resourceId=${encodeURIComponent(id)}&limit=50`).then(r => r.data || [])))
      .then(lists => {
        if (cancelled) return;
        const seen = new Set<string>();
        setEvents(lists.flat().filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      })
      .catch(err => { if (!cancelled) setError(mapError(err, "Não foi possível carregar a actividade.")); });
    return () => { cancelled = true; };
  }, [documentId, identifierId]);

  if (error) return <p className="text-sm text-docid-muted">{error}</p>;
  if (!events) return <p className="text-sm text-docid-muted">A carregar...</p>;
  if (events.length === 0) return <p className="text-sm text-docid-muted">Sem actividade registada que possa ver.</p>;
  return (
    <ol className="relative space-y-4 border-l border-docid-border pl-4" data-testid="document-activity">
      {events.map(e => (
        <li key={e.id}>
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-docid-surface bg-docid-primary" />
          <p className="text-sm text-docid-text">{ACTIVITY_LABELS[e.action] ?? "Acção registada"}</p>
          <p className="text-[11px] text-docid-muted">{e.userName || "Sistema"} · {new Date(e.createdAt).toLocaleString("pt-AO")}</p>
        </li>
      ))}
    </ol>
  );
}
