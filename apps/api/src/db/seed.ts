import { db } from "./index";
import { categories, roles, rolePermissions } from "./schema";
import { eq, and, isNull } from "drizzle-orm";

const CATEGORIES: Array<{ id: string; name: string; group: string; prefix: string; defaultVisibility: "public" | "sector_only" }> = [
  { id: "PROP", prefix: "PROP", group: "Comercial",     name: "Proposta Comercial",                      defaultVisibility: "public" },
  { id: "FAT",  prefix: "FAT",  group: "Comercial",     name: "Factura",                                 defaultVisibility: "public" },
  { id: "REC",  prefix: "REC",  group: "Comercial",     name: "Recibo",                                  defaultVisibility: "public" },
  { id: "NOT",  prefix: "NOT",  group: "Comercial",     name: "Nota de Crédito",                         defaultVisibility: "public" },
  { id: "NDB",  prefix: "NDB",  group: "Comercial",     name: "Nota de Débito",                          defaultVisibility: "public" },
  { id: "ORD",  prefix: "ORD",  group: "Comercial",     name: "Ordem de Compra",                         defaultVisibility: "public" },
  { id: "GUE",  prefix: "GUE",  group: "Comercial",     name: "Guia de Entrega / Remessa",               defaultVisibility: "public" },
  { id: "COT",  prefix: "COT",  group: "Comercial",     name: "Cotação",                                 defaultVisibility: "public" },
  { id: "REL",  prefix: "REL",  group: "Financeiro",    name: "Relatório Financeiro",                    defaultVisibility: "public" },
  { id: "EXT",  prefix: "EXT",  group: "Financeiro",    name: "Extracto de Conta",                       defaultVisibility: "public" },
  { id: "ORC",  prefix: "ORC",  group: "Financeiro",    name: "Orçamento Interno",                       defaultVisibility: "public" },
  { id: "AUT",  prefix: "AUT",  group: "Financeiro",    name: "Autorização de Pagamento",                defaultVisibility: "public" },
  { id: "TRF",  prefix: "TRF",  group: "Financeiro",    name: "Comprovativo de Transferência",           defaultVisibility: "public" },
  { id: "CTR",  prefix: "CTR",  group: "RH",            name: "Contrato de Trabalho",                    defaultVisibility: "sector_only" },
  { id: "TER",  prefix: "TER",  group: "RH",            name: "Termo de Rescisão",                       defaultVisibility: "sector_only" },
  { id: "FLC",  prefix: "FLC",  group: "RH",            name: "Folha de Salário / Recibo de Vencimento", defaultVisibility: "sector_only" },
  { id: "DEC",  prefix: "DEC",  group: "RH",            name: "Declaração de Vínculo",                   defaultVisibility: "sector_only" },
  { id: "MAP",  prefix: "MAP",  group: "RH",            name: "Mapa de Férias",                          defaultVisibility: "sector_only" },
  { id: "ADM",  prefix: "ADM",  group: "RH",            name: "Admissão de Colaborador",                 defaultVisibility: "sector_only" },
  { id: "CPS",  prefix: "CPS",  group: "Jurídico",      name: "Contrato de Prestação de Serviços",       defaultVisibility: "sector_only" },
  { id: "CPF",  prefix: "CPF",  group: "Jurídico",      name: "Contrato de Parceria / Fornecimento",     defaultVisibility: "sector_only" },
  { id: "NDA",  prefix: "NDA",  group: "Jurídico",      name: "Acordo de Confidencialidade (NDA)",       defaultVisibility: "sector_only" },
  { id: "SLA",  prefix: "SLA",  group: "Jurídico",      name: "Acordo de Nível de Serviço (SLA)",        defaultVisibility: "sector_only" },
  { id: "MOU",  prefix: "MOU",  group: "Jurídico",      name: "Memorando de Entendimento (MOU)",         defaultVisibility: "sector_only" },
  { id: "POW",  prefix: "POW",  group: "Jurídico",      name: "Procuração",                              defaultVisibility: "sector_only" },
  { id: "ACO",  prefix: "ACO",  group: "Jurídico",      name: "Acordo de Colaboração",                   defaultVisibility: "sector_only" },
  { id: "LIC",  prefix: "LIC",  group: "Jurídico",      name: "Contrato de Licenciamento",               defaultVisibility: "sector_only" },
  { id: "CLA",  prefix: "CLA",  group: "Jurídico",      name: "Contrato de Locação / Arrendamento",      defaultVisibility: "sector_only" },
  { id: "GAR",  prefix: "GAR",  group: "Jurídico",      name: "Carta de Garantia",                       defaultVisibility: "sector_only" },
  { id: "TIT",  prefix: "TIT",  group: "Jurídico",      name: "Título Executivo / Livrança",             defaultVisibility: "sector_only" },
  { id: "ATA",  prefix: "ATA",  group: "Administrativo", name: "Acta de Reunião",                        defaultVisibility: "public" },
  { id: "MEM",  prefix: "MEM",  group: "Administrativo", name: "Memorando Interno",                      defaultVisibility: "public" },
  { id: "CIR",  prefix: "CIR",  group: "Administrativo", name: "Circular",                               defaultVisibility: "public" },
  { id: "REQ",  prefix: "REQ",  group: "Administrativo", name: "Requisição Interna",                     defaultVisibility: "public" },
  { id: "POL",  prefix: "POL",  group: "Administrativo", name: "Política / Regulamento Interno",         defaultVisibility: "public" },
  { id: "PRO",  prefix: "PRO",  group: "Administrativo", name: "Procedimento Operacional",               defaultVisibility: "public" },
  { id: "DEL",  prefix: "DEL",  group: "Administrativo", name: "Despacho / Deliberação",                 defaultVisibility: "public" },
  { id: "ESP",  prefix: "ESP",  group: "Técnico",       name: "Especificação Técnica",                   defaultVisibility: "public" },
  { id: "MAN",  prefix: "MAN",  group: "Técnico",       name: "Manual de Utilização",                    defaultVisibility: "public" },
  { id: "REP",  prefix: "REP",  group: "Técnico",       name: "Relatório Técnico",                       defaultVisibility: "public" },
  { id: "TAS",  prefix: "TAS",  group: "Técnico",       name: "Termo de Aceitação / Entrega",            defaultVisibility: "public" },
  { id: "PLN",  prefix: "PLN",  group: "Técnico",       name: "Plano de Projecto",                       defaultVisibility: "public" },
];

const SYSTEM_ROLES = [
  { name: "ORG_ADMIN", permissions: [{ resource: "documents", action: "read" }, { resource: "documents", action: "create" }, { resource: "documents", action: "approve" }, { resource: "identifiers", action: "generate" }, { resource: "sectors", action: "manage" }, { resource: "users", action: "manage" }, { resource: "audit", action: "read" }, { resource: "roles", action: "manage" }] },
  { name: "SECTOR_SUPERVISOR", permissions: [{ resource: "documents", action: "read" }, { resource: "documents", action: "create" }, { resource: "documents", action: "approve" }, { resource: "identifiers", action: "generate" }] },
  { name: "MEMBER", permissions: [{ resource: "documents", action: "read" }, { resource: "documents", action: "create" }, { resource: "identifiers", action: "generate" }] },
];

async function seed() {
  for (const cat of CATEGORIES) {
    await db.insert(categories).values(cat).onConflictDoUpdate({
      target: categories.id,
      set: { name: cat.name, group: cat.group, prefix: cat.prefix, defaultVisibility: cat.defaultVisibility },
    });
  }

  for (const sysRole of SYSTEM_ROLES) {
    let role: (typeof roles.$inferSelect) | undefined;
    const existingRole = await db.query.roles.findFirst({
      where: and(eq(roles.name, sysRole.name), isNull(roles.tenantId)),
    });

    if (existingRole) {
      role = existingRole;
    } else {
      const [newRole] = await db.insert(roles).values({
        name: sysRole.name,
        isSystem: true,
        tenantId: null,
      }).returning();
      role = newRole;
    }

    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    for (const perm of sysRole.permissions) {
      await db.insert(rolePermissions).values({ roleId: role.id, resource: perm.resource, action: perm.action });
    }
  }

  console.log("Seed completo: categorias + roles de sistema.");
}

seed().catch(console.error);
