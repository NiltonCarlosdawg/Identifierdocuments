import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { eq } from "drizzle-orm";

export const sqlite = new Database("./verano_docs.db");
sqlite.run("PRAGMA journal_mode = WAL");
sqlite.run("PRAGMA foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// ─────────────────────────────────────────────────────────────────────────────
// CRIAÇÃO DAS TABELAS (sem migrator externo — usa SQL directo)
// ─────────────────────────────────────────────────────────────────────────────

export function initDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS document_categories (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      grp          TEXT NOT NULL,
      description  TEXT,
      prefix       TEXT NOT NULL UNIQUE,
      created_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_identifiers (
      id            TEXT PRIMARY KEY,
      identifier    TEXT NOT NULL UNIQUE,
      category_id   TEXT NOT NULL REFERENCES document_categories(id),
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','attached','cancelled')),
      issued_to     TEXT,
      description   TEXT,
      sequence      INTEGER NOT NULL,
      year          INTEGER NOT NULL,
      month         INTEGER NOT NULL,
      day           INTEGER NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      cancelled_at  TEXT,
      cancel_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS attached_documents (
      id                TEXT PRIMARY KEY,
      identifier_id     TEXT NOT NULL UNIQUE REFERENCES document_identifiers(id),
      original_name     TEXT NOT NULL,
      mime_type         TEXT NOT NULL,
      file_path         TEXT NOT NULL,
      file_size_bytes   INTEGER NOT NULL,
      identifier_found  INTEGER NOT NULL,
      verified_at       TEXT NOT NULL,
      uploaded_at       TEXT NOT NULL,
      uploaded_by       TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id             TEXT PRIMARY KEY,
      action         TEXT NOT NULL,
      identifier_id  TEXT,
      detail         TEXT,
      performed_by   TEXT,
      created_at     TEXT NOT NULL
    );
  `);

  seedCategories();
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED — todas as categorias de documentos empresariais
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES: Array<{
  id: string; name: string; group: string;
  description: string; prefix: string;
}> = [
  // ── Comercial ──────────────────────────────────────────────────────────
  { id: "PROP", prefix: "PROP", group: "Comercial",   name: "Proposta Comercial",           description: "Orçamentos e propostas enviadas a clientes" },
  { id: "FAT",  prefix: "FAT",  group: "Comercial",   name: "Factura",                      description: "Factura de venda de bens ou serviços" },
  { id: "REC",  prefix: "REC",  group: "Comercial",   name: "Recibo",                       description: "Comprovativo de pagamento recebido" },
  { id: "NOT",  prefix: "NOT",  group: "Comercial",   name: "Nota de Crédito",              description: "Devolução ou desconto após facturação" },
  { id: "NDB",  prefix: "NDB",  group: "Comercial",   name: "Nota de Débito",               description: "Cobrança adicional após facturação" },
  { id: "ORD",  prefix: "ORD",  group: "Comercial",   name: "Ordem de Compra",              description: "Pedido formal de aquisição de bens/serviços" },
  { id: "GUE",  prefix: "GUE",  group: "Comercial",   name: "Guia de Entrega / Remessa",    description: "Acompanha a entrega física de bens" },
  { id: "COT",  prefix: "COT",  group: "Comercial",   name: "Cotação",                      description: "Resposta informal a pedido de preço" },

  // ── Financeiro ─────────────────────────────────────────────────────────
  { id: "REL",  prefix: "REL",  group: "Financeiro",  name: "Relatório Financeiro",         description: "Balanços, demonstrações de resultados" },
  { id: "EXT",  prefix: "EXT",  group: "Financeiro",  name: "Extracto de Conta",            description: "Movimentos de conta bancária ou cliente" },
  { id: "ORC",  prefix: "ORC",  group: "Financeiro",  name: "Orçamento Interno",            description: "Planeamento financeiro interno" },
  { id: "AUT",  prefix: "AUT",  group: "Financeiro",  name: "Autorização de Pagamento",     description: "Aprovação interna para efectuar pagamento" },
  { id: "TRF",  prefix: "TRF",  group: "Financeiro",  name: "Comprovativo de Transferência",description: "Prova de transferência bancária efectuada" },

  // ── Recursos Humanos ───────────────────────────────────────────────────
  { id: "CTR",  prefix: "CTR",  group: "RH",          name: "Contrato de Trabalho",         description: "Contrato individual de trabalho" },
  { id: "TER",  prefix: "TER",  group: "RH",          name: "Termo de Rescisão",            description: "Rescisão de contrato de trabalho" },
  { id: "FLC",  prefix: "FLC",  group: "RH",          name: "Folha de Salário / Recibo de Vencimento", description: "Demonstrativo mensal de salário" },
  { id: "DEC",  prefix: "DEC",  group: "RH",          name: "Declaração de Vínculo",        description: "Declaração de que o colaborador é funcionário" },
  { id: "MAP",  prefix: "MAP",  group: "RH",          name: "Mapa de Férias",               description: "Planeamento e aprovação de férias" },
  { id: "ADM",  prefix: "ADM",  group: "RH",          name: "Admissão de Colaborador",      description: "Registo de admissão de novo funcionário" },

  // ── Jurídico / Contratos ───────────────────────────────────────────────
  { id: "CPS",  prefix: "CPS",  group: "Jurídico",    name: "Contrato de Prestação de Serviços", description: "Contrato entre empresa e prestador" },
  { id: "CPF",  prefix: "CPF",  group: "Jurídico",    name: "Contrato de Parceria / Fornecimento", description: "Acordo formal com parceiros ou fornecedores" },
  { id: "NDA",  prefix: "NDA",  group: "Jurídico",    name: "Acordo de Confidencialidade (NDA)", description: "Non-Disclosure Agreement" },
  { id: "SLA",  prefix: "SLA",  group: "Jurídico",    name: "Acordo de Nível de Serviço (SLA)", description: "Service Level Agreement" },
  { id: "MOU",  prefix: "MOU",  group: "Jurídico",    name: "Memorando de Entendimento (MOU)", description: "Memorandum of Understanding" },
  { id: "POW",  prefix: "POW",  group: "Jurídico",    name: "Procuração",                   description: "Delegação de poderes a terceiro" },
  { id: "ACO",  prefix: "ACO",  group: "Jurídico",    name: "Acordo de Colaboração",        description: "Acordo geral de cooperação entre entidades" },
  { id: "LIC",  prefix: "LIC",  group: "Jurídico",    name: "Contrato de Licenciamento",    description: "Licença de uso de software, marca ou propriedade intelectual" },
  { id: "CLA",  prefix: "CLA",  group: "Jurídico",    name: "Contrato de Locação / Arrendamento", description: "Arrendamento de imóvel ou equipamento" },
  { id: "GAR",  prefix: "GAR",  group: "Jurídico",    name: "Carta de Garantia",            description: "Garantia formal de produto ou serviço" },
  { id: "TIT",  prefix: "TIT",  group: "Jurídico",    name: "Título Executivo / Livrança",  description: "Instrumento de dívida com força executiva" },

  // ── Administrativo / Interno ───────────────────────────────────────────
  { id: "ATA",  prefix: "ATA",  group: "Administrativo", name: "Acta de Reunião",           description: "Registo oficial de decisões em reunião" },
  { id: "MEM",  prefix: "MEM",  group: "Administrativo", name: "Memorando Interno",         description: "Comunicação interna formal" },
  { id: "CIR",  prefix: "CIR",  group: "Administrativo", name: "Circular",                  description: "Comunicação para múltiplos destinatários" },
  { id: "REQ",  prefix: "REQ",  group: "Administrativo", name: "Requisição Interna",        description: "Pedido interno de materiais ou serviços" },
  { id: "POL",  prefix: "POL",  group: "Administrativo", name: "Política / Regulamento Interno", description: "Normas e regras internas da empresa" },
  { id: "PRO",  prefix: "PRO",  group: "Administrativo", name: "Procedimento Operacional",  description: "Documento de processo ou fluxo de trabalho" },
  { id: "DEL",  prefix: "DEL",  group: "Administrativo", name: "Despacho / Deliberação",    description: "Decisão formal de órgão de gestão" },

  // ── Projecto & Técnico ─────────────────────────────────────────────────
  { id: "ESP",  prefix: "ESP",  group: "Técnico",     name: "Especificação Técnica",        description: "Requisitos e especificações de projecto" },
  { id: "MAN",  prefix: "MAN",  group: "Técnico",     name: "Manual de Utilização",         description: "Guia de uso de produto ou sistema" },
  { id: "REP",  prefix: "REP",  group: "Técnico",     name: "Relatório Técnico",            description: "Análise ou diagnóstico técnico" },
  { id: "TAS",  prefix: "TAS",  group: "Técnico",     name: "Termo de Aceitação / Entrega", description: "Confirmação formal de entrega de projecto" },
  { id: "PLN",  prefix: "PLN",  group: "Técnico",     name: "Plano de Projecto",            description: "Planeamento de fases, recursos e prazos" },
];

function seedCategories() {
  const now = new Date().toISOString();
  for (const cat of CATEGORIES) {
    const exists = sqlite.prepare(
      "SELECT id FROM document_categories WHERE id = ?"
    ).get(cat.id);
    if (!exists) {
      sqlite.prepare(`
        INSERT INTO document_categories (id, name, grp, description, prefix, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(cat.id, cat.name, cat.group, cat.description, cat.prefix, now);
    }
  }
}
