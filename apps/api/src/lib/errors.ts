const PG_ERROR_MAP: Record<string, string> = {
  "23505": "Já existe um registo com esse valor único.",
  "23503": "Operação inválida: registo referenciado não existe.",
  "23502": "Operação inválida: campo obrigatório em falta.",
  "42P01": "Erro interno: tabela não encontrada.",
  "22P02": "Formato de dados inválido.",
};

const PG_UNIQUE_PATTERN = /duplicate key (?:value|error)/i;
const PG_FK_PATTERN = /foreign key constraint/i;
const PG_NOT_NULL_PATTERN = /null value in column/i;

export function safeError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const pgCode = (err as any).code as string;
    if (PG_ERROR_MAP[pgCode]) return PG_ERROR_MAP[pgCode];
  }
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as any).message as string;
    if (PG_UNIQUE_PATTERN.test(msg)) return "Já existe um registo com esse valor único.";
    if (PG_FK_PATTERN.test(msg)) return "Operação inválida: registo referenciado não existe.";
    if (PG_NOT_NULL_PATTERN.test(msg)) return "Operação inválida: campo obrigatório em falta.";
  }
  return "Ocorreu um erro inesperado.";
}
