import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { authMiddleware } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";
import { authModule } from "./modules/auth.module";
import { tenantsModule } from "./modules/tenants.module";
import { sectorsModule } from "./modules/sectors.module";
import { usersModule } from "./modules/users.module";
import { rolesModule } from "./modules/roles.module";
import { categoriesModule } from "./modules/categories.module";
import { identifiersModule } from "./modules/identifiers.module";
import { documentsModule } from "./modules/documents.module";

import { approvalsModule } from "./modules/approvals.module";
import { auditModule } from "./modules/audit.module";
import { statsModule } from "./modules/stats.module";
import { classifierModule } from "./modules/classifier.module";
import { notificationSSEModule } from "./services/notification.service";

const app = new Elysia()
  .use(cors({
    origin: ["http://localhost:1420", "tauri://localhost", "https://tauri.localhost"],
    credentials: true,
  }))
  .use(swagger({
    documentation: {
      info: {
        title: "Verano Labs — DocID API",
        version: "1.0.0",
        description: "API multi-tenant de gestão de documentos empresariais com autenticação JWT, RBAC e RLS.",
        contact: { name: "Verano Labs", email: "geralverano@verano.sbs" },
      },
      tags: [
        { name: "Autenticação", description: "Login, perfil, alterar password" },
        { name: "Organizações", description: "Gestão de tenants" },
        { name: "Sectores", description: "Gestão de sectores" },
        { name: "Utilizadores", description: "Gestão de utilizadores" },
        { name: "Roles", description: "Roles e permissões" },
        { name: "Categorias", description: "Categorias de documentos" },
        { name: "Identificadores", description: "Geração e consulta de IDs" },
        { name: "Documentos", description: "Upload e download" },
        { name: "Partilha", description: "Partilha entre sectores" },
        { name: "Aprovações", description: "Workflow de aprovação" },
        { name: "Auditoria", description: "Log de operações" },
        { name: "Estatísticas", description: "Métricas" },
        { name: "Notificações", description: "SSE em tempo real" },
        { name: "Classificador", description: "Classificação por IA (Groq)" },
      ],
      servers: [{ url: "http://localhost:3000", description: "Desenvolvimento" }],
    },
    path: "/docs",
  }))
  .use(authMiddleware)
  .use(tenantMiddleware)
  .get("/", () => ({
    name: "Verano Labs — DocID API",
    version: "2.0.0",
    status: "online",
    docs: "/docs",
  }), { detail: { summary: "Health check", tags: ["Sistema"] } })
  .get("/health", () => ({
    status: "healthy",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }), { detail: { summary: "Health check detalhado", tags: ["Sistema"] } })

  .use(authModule)
  .use(tenantsModule)
  .use(sectorsModule)
  .use(usersModule)
  .use(rolesModule)
  .use(categoriesModule)
  .use(identifiersModule)
  .use(documentsModule)

  .use(approvalsModule)
  .use(auditModule)
  .use(statsModule)
  .use(classifierModule)
  .use(notificationSSEModule)
  .onError(({ code, error, set }) => {
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Rota não encontrada." } };
    }
    if (code === "VALIDATION") {
      set.status = 422;
      return { error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } };
    }
    set.status = 500;
    console.error("[ERROR]", error);
    return { error: { code: "INTERNAL_ERROR", message: "Erro interno do servidor." } };
  })
  .listen(3000);

console.log(`
  ╔═══════════════════════════════════════════╗
  ║    Verano Labs — DocID API v1.0.0         ║
  ║    http://localhost:3000                  ║
  ║    Swagger: http://localhost:3000/docs    ║
  ╚═══════════════════════════════════════════╝
`);

export type App = typeof app;
