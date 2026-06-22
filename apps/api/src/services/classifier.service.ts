const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `Classifique o documento empresarial abaixo numa das 45 categorias do sistema DocID.
Responda APENAS com um JSON: { "categoryId": "XXX", "confidence": 0.0-1.0, "reasoning": "curta justificação" }

Categorias disponíveis (formato: ID — Nome [Grupo]):
PROP — Proposta Comercial [Comercial]
FAT — Factura [Comercial]
REC — Recibo [Comercial]
NOT — Nota de Crédito [Comercial]
NDB — Nota de Débito [Comercial]
ORD — Ordem de Compra [Comercial]
GUE — Guia de Entrega / Remessa [Comercial]
COT — Cotação [Comercial]
REL — Relatório Financeiro [Financeiro]
EXT — Extracto de Conta [Financeiro]
ORC — Orçamento Interno [Financeiro]
AUT — Autorização de Pagamento [Financeiro]
TRF — Comprovativo de Transferência [Financeiro]
CTR — Contrato de Trabalho [RH]
TER — Termo de Rescisão [RH]
FLC — Folha de Salário [RH]
DEC — Declaração de Vínculo [RH]
MAP — Mapa de Férias [RH]
ADM — Admissão de Colaborador [RH]
CPS — Contrato de Prestação de Serviços [Jurídico]
CPF — Contrato de Parceria / Fornecimento [Jurídico]
NDA — Acordo de Confidencialidade [Jurídico]
SLA — Acordo de Nível de Serviço [Jurídico]
MOU — Memorando de Entendimento [Jurídico]
POW — Procuração [Jurídico]
ACO — Acordo de Colaboração [Jurídico]
LIC — Contrato de Licenciamento [Jurídico]
CLA — Contrato de Locação / Arrendamento [Jurídico]
GAR — Carta de Garantia [Jurídico]
TIT — Título Executivo / Livrança [Jurídico]
ATA — Acta de Reunião [Administrativo]
MEM — Memorando Interno [Administrativo]
CIR — Circular [Administrativo]
REQ — Requisição Interna [Administrativo]
POL — Política / Regulamento Interno [Administrativo]
PRO — Procedimento Operacional [Administrativo]
DEL — Despacho / Deliberação [Administrativo]
ESP — Especificação Técnica [Técnico]
MAN — Manual de Utilização [Técnico]
REP — Relatório Técnico [Técnico]
TAS — Termo de Aceitação / Entrega [Técnico]
PLN — Plano de Projecto [Técnico]`;

export interface ClassificationResult {
  categoryId: string;
  confidence: number;
  reasoning: string;
}

export async function suggestCategory(text: string, filename?: string): Promise<ClassificationResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { categoryId: "UNKNOWN", confidence: 0, reasoning: "GROQ_API_KEY não configurada." };
  }

  const userContent = filename
    ? `Nome do ficheiro: ${filename}\n\nConteúdo do documento:\n${text.slice(0, 4000)}`
    : `Conteúdo do documento:\n${text.slice(0, 4000)}`;

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 200,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error (${res.status}): ${err}`);
  }

  const data = await res.json() as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Resposta vazia da Groq API.");

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Formato inesperado da Groq API.");

  return JSON.parse(jsonMatch[0]) as ClassificationResult;
}
