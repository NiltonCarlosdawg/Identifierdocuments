import { db } from "./index";
import { categories, roles, rolePermissions } from "./schema";
import { eq, and } from "drizzle-orm";

const CATEGORIES: Array<{ id: string; name: string; group: string; prefix: string }> = [
  { id: "PROP", prefix: "PROP", group: "Comercial",   name: "Proposta Comercial" },
  { id: "FAT",  prefix: "FAT",  group: "Comercial",   name: "Factura" },
  { id: "REC",  prefix: "REC",  group: "Comercial",   name: "Recibo" },
  { id: "NOT",  prefix: "NOT",  group: "Comercial",   name: "Nota de Crédito" },
  { id: "NDB",  prefix: "NDB",  group: "Comercial",   name: "Nota de Débito" },
  { id: "ORD",  prefix: "ORD",  group: "Comercial",   name: "Ordem de Compra" },
  { id: "GUE",  prefix: "GUE",  group: "Comercial",   name: "Guia de Entrega / Remessa" },
  { id: "COT",  prefix: "COT",  group: "Comercial",   name: "Cotação" },
  { id: "REL",  prefix: "REL",  group: "Financeiro",  name: "Relatório Financeiro" },
  { id: "EXT",  prefix: "EXT",  group: "Financeiro",  name: "Extracto de Conta" },
  { id: "ORC",  prefix: "ORC",  group: "Financeiro",  name: "Orçamento Interno" },
  { id: "AUT",  prefix: "AUT",  group: "Financeiro",  name: "Autorização de Pagamento" },
  { id: "TRF",  prefix: "TRF",  group: "Financeiro",  name: "Comprovativo de Transferência" },
  { id: "CTR",  prefix: "CTR",  group: "RH",          name: "Contrato de Trabalho" },
  { id: "TER",  prefix: "TER",  group: "RH",          name: "Termo de Rescisão" },
  { id: "FLC",  prefix: "FLC",  group: "RH",          name: "Folha de Salário / Recibo de Vencimento" },
  { id: "DEC",  prefix: "DEC",  group: "RH",          name: "Declaração de Vínculo" },
  { id: "MAP",  prefix: "MAP",  group: "RH",          name: "Mapa de Férias" },
  { id: "ADM",  prefix: "ADM",  group: "RH",          name: "Admissão de Colaborador" },
  { id: "CPS",  prefix: "CPS",  group: "Jurídico",    name: "Contrato de Prestação de Serviços" },
  { id: "CPF",  prefix: "CPF",  group: "Jurídico",    name: "Contrato de Parceria / Fornecimento" },
  { id: "NDA",  prefix: "NDA",  group: "Jurídico",    name: "Acordo de Confidencialidade (NDA)" },
  { id: "SLA",  prefix: "SLA",  group: "Jurídico",    name: "Acordo de Nível de Serviço (SLA)" },
  { id: "MOU",  prefix: "MOU",  group: "Jurídico",    name: "Memorando de Entendimento (MOU)" },
  { id: "POW",  prefix: "POW",  group: "Jurídico",    name: "Procuração" },
  { id: "ACO",  prefix: "ACO",  group: "Jurídico",    name: "Acordo de Colaboração" },
  { id: "LIC",  prefix: "LIC",  group: "Jurídico",    name: "Contrato de Licenciamento" },
  { id: "CLA",  prefix: "CLA",  group: "Jurídico",    name: "Contrato de Locação / Arrendamento" },
  { id: "GAR",  prefix: "GAR",  group: "Jurídico",    name: "Carta de Garantia" },
  { id: "TIT",  prefix: "TIT",  group: "Jurídico",    name: "Título Executivo / Livrança" },
  { id: "ATA",  prefix: "ATA",  group: "Administrativo", name: "Acta de Reunião" },
  { id: "MEM",  prefix: "MEM",  group: "Administrativo", name: "Memorando Interno" },
  { id: "CIR",  prefix: "CIR",  group: "Administrativo", name: "Circular" },
  { id: "REQ",  prefix: "REQ",  group: "Administrativo", name: "Requisição Interna" },
  { id: "POL",  prefix: "POL",  group: "Administrativo", name: "Política / Regulamento Interno" },
  { id: "PRO",  prefix: "PRO",  group: "Administrativo", name: "Procedimento Operacional" },
  { id: "DEL",  prefix: "DEL",  group: "Administrativo", name: "Despacho / Deliberação" },
  { id: "ESP",  prefix: "ESP",  group: "Técnico",     name: "Especificação Técnica" },
  { id: "MAN",  prefix: "MAN",  group: "Técnico",     name: "Manual de Utilização" },
  { id: "REP",  prefix: "REP",  group: "Técnico",     name: "Relatório Técnico" },
  { id: "TAS",  prefix: "TAS",  group: "Técnico",     name: "Termo de Aceitação / Entrega" },
  { id: "PLN",  prefix: "PLN",  group: "Técnico",     name: "Plano de Projecto" },
];

const SYSTEM_ROLES = [
  { name: "ORG_ADMIN", permissions: [{ resource: "documents", action: "read" }, { resource: "documents", action: "create" }, { resource: "documents", action: "approve" }, { resource: "identifiers", action: "generate" }, { resource: "sectors", action: "manage" }, { resource: "users", action: "manage" }, { resource: "audit", action: "read" }, { resource: "roles", action: "manage" }] },
  { name: "SECTOR_SUPERVISOR", permissions: [{ resource: "documents", action: "read" }, { resource: "documents", action: "create" }, { resource: "documents", action: "approve" }, { resource: "identifiers", action: "generate" }] },
  { name: "MEMBER", permissions: [{ resource: "documents", action: "read" }, { resource: "documents", action: "create" }, { resource: "identifiers", action: "generate" }] },
];

async function seed() {
  for (const cat of CATEGORIES) {
    await db.insert(categories).values(cat).onConflictDoNothing({ target: categories.id });
  }

  for (const sysRole of SYSTEM_ROLES) {
    const existingRole = await db.select().from(roles).where(
      and(eq(roles.name, sysRole.name), eq(roles.isSystem, true))
    );
    if (existingRole.length === 0) {
      const [role] = await db.insert(roles).values({ name: sysRole.name, isSystem: true, tenantId: null }).returning();
      for (const perm of sysRole.permissions) {
        await db.insert(rolePermissions).values({ roleId: role.id, resource: perm.resource, action: perm.action });
      }
    }
  }

  console.log("Seed completo: categorias + roles de sistema.");
}

seed().catch(console.error);
