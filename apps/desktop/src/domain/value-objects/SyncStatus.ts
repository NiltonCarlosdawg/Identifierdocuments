export const SyncStatusLabels: Record<string, string> = {
  pending: "Pendente",
  uploading: "A enviar...",
  uploaded: "Enviado",
  failed: "Falhou",
};

export const SyncStatusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  uploading: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  uploaded: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};
