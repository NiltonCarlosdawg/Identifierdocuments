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

// Lista derivada dos IDs anunciados no SYSTEM_PROMPT acima. Mantém-se em sincronia
// manual com esse texto — se adicionares/removeres categorias ali, actualiza aqui
// também (idealmente isto viria da tabela `categories` da BD; deixei como constante
// simples para não introduzir uma dependência de DB neste ficheiro sem confirmar
// que é desejado).
const VALID_CATEGORY_IDS = new Set([
  "PROP", "FAT", "REC", "NOT", "NDB", "ORD", "GUE", "COT",
  "REL", "EXT", "ORC", "AUT", "TRF",
  "CTR", "TER", "FLC", "DEC", "MAP", "ADM",
  "CPS", "CPF", "NDA", "SLA", "MOU", "POW", "ACO", "LIC", "CLA", "GAR", "TIT",
  "ATA", "MEM", "CIR", "REQ", "POL", "PRO", "DEL",
  "ESP", "MAN", "REP", "TAS", "PLN",
]);

export async function suggestCategory(text: string, filename?: string): Promise<ClassificationResult> {
  const apiKey = process.env.GROQ_API_KEY;
  const enabled = process.env.CLASSIFIER_ENABLED === "true";
  if (!apiKey || !enabled) {
    return {
      categoryId: "UNKNOWN",
      confidence: 0,
      reasoning: !apiKey ? "GROQ_API_KEY não configurada." : "Classificador IA desativado. Active CLASSIFIER_ENABLED=true nas variáveis de ambiente.",
    };
  }

  const userContent = filename
    ? `Nome do ficheiro: ${filename}\n\nConteúdo do documento:\n${text.slice(0, 4000)}`
    : `Conteúdo do documento:\n${text.slice(0, 4000)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
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
      // CORREÇÃO: 200 tokens é uma margem apertada para { categoryId, confidence,
      // reasoning } — um "reasoning" um pouco mais longo pode cortar o JSON a meio e
      // partir o JSON.parse abaixo. Aumentado para dar folga sem custo relevante.
      max_tokens: 300,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error (${res.status}): ${err}`);
  }

  const data = await res.json() as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Resposta vazia da Groq API.");

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Formato inesperado da Groq API.");

  // CORREÇÃO: antes fazia-se `JSON.parse(...)` e devolvia-se directamente o resultado,
  // confiando cegamente em (a) o parse não rebentar com uma resposta truncada/malformada
  // e (b) o categoryId devolvido pela IA corresponder de facto a uma categoria real do
  // sistema. Uma alucinação do modelo (ex.: inventar "FATU" em vez de "FAT") passava
  // directamente para o resto da aplicação, que só descobriria o problema mais tarde
  // ao tentar usar esse categoryId (ex.: em generateIdentifier, que lançaria erro só
  // nesse ponto). Agora validamos aqui e devolvemos um resultado seguro em caso de
  // parse inválido ou categoria desconhecida.
  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { categoryId: "UNKNOWN", confidence: 0, reasoning: "Resposta da IA não era JSON válido." };
  }

  const categoryId = typeof parsed.categoryId === "string" ? parsed.categoryId.toUpperCase().trim() : "";
  if (!VALID_CATEGORY_IDS.has(categoryId)) {
    return { categoryId: "UNKNOWN", confidence: 0, reasoning: `IA sugeriu categoria desconhecida ("${parsed.categoryId ?? "?"}").` };
  }

  const confidence = typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
    ? parsed.confidence
    : 0;

  return {
    categoryId,
    confidence,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
  };
}