import Elysia from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { node } from "@elysiajs/node";
import { authMiddleware } from "./middleware/auth";
import { tenantMiddleware } from "./middleware/tenant";
import { licenseGuard } from "./middleware/licenseGuard";
import { authModule } from "./modules/auth.module";
import { tenantsModule } from "./modules/tenants.module";
import { sectorsModule } from "./modules/sectors.module";
import { usersModule } from "./modules/users.module";
import { rolesModule } from "./modules/roles.module";
import { categoriesModule } from "./modules/categories.module";
import { identifiersModule } from "./modules/identifiers.module";
import { documentsModule } from "./modules/documents.module";
import { providerModule } from "./modules/provider.module";
import { plansModule } from "./modules/plans.module";
import { subscriptionsModule } from "./modules/subscriptions.module";

import { approvalsModule } from "./modules/approvals.module";
import { auditModule } from "./modules/audit.module";
import { statsModule } from "./modules/stats.module";
import { devicesModule } from "./modules/devices.module";
import { classifierModule } from "./modules/classifier.module";
import { notificationSSEModule } from "./services/notification.service";
import { logger } from "./lib/logger";
import { startWorkers } from "./jobs/workers";
import { startEmailWorker } from "./jobs/email-worker";
import { emailModule, emailLinksModule } from "./modules/email.module";
import { platformModule } from "./modules/platform.module";
import { getClientIp } from "./lib/ip";
import { ALLOWED_ORIGINS } from "./lib/cors";

const requestTimings = new WeakMap<Request, number>();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";
const enableSwagger = process.env.ENABLE_SWAGGER === "true" || !isProduction;

if (isProduction) {
  if (enableSwagger) logger.warn("[SEGURANÇA] ENABLE_SWAGGER=true em produção: a documentação da API fica pública em /docs.");
  if (process.env.ALLOW_PUBLIC_ONBOARDING === "true") {
    logger.warn("[SEGURANÇA] ALLOW_PUBLIC_ONBOARDING=true em produção: qualquer pessoa pode criar organizações.");
  }
}

// Bun (dev/testes) mantém o adapter nativo; Node usa o adapter oficial —
// o cPanel LGI/LVE limita processos/threads e o Bun não arranca em produção.
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

const app = new (Elysia as any)(isBun ? {} : { adapter: node() })
  .use(cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  }));

if (enableSwagger) {
  app.use(swagger({
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
        { name: "E-mail", description: "Notificações por e-mail por organização" },
        { name: "Plataforma", description: "Gestão de licenças (token da plataforma)" },
      ],
      servers: [{ url: `http://localhost:${PORT}`, description: "Desenvolvimento" }],
    },
    path: "/docs",
  }));
}

app
  .use(authMiddleware)
  .use(tenantMiddleware)
  .use(licenseGuard)
  .derive(({ request }: { request: Request }) => ({ clientIp: getClientIp(request) }))
  .onRequest(({ request }) => {
    requestTimings.set(request, performance.now());
  })
  .onAfterHandle((ctx: any) => {
    const { request, set } = ctx;
    const start = requestTimings.get(request);
    const url = new URL(request.url);
    logger.info({
      method: request.method,
      path: url.pathname,
      status: set.status,
      durationMs: start ? Math.round(performance.now() - start) : undefined,
    });
    requestTimings.delete(request);
  })
  .get("/", () => ({
    name: "Verano Labs — DocID API",
    version: "2.0.0",
    status: "online",
    docs: enableSwagger ? "/docs" : undefined,
  }), { detail: { summary: "Health check", tags: ["Sistema"] } })
  .get("/health", () => ({
    status: "healthy",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }), { detail: { summary: "Health check detalhado", tags: ["Sistema"] } })

  .use(emailLinksModule) // público (link assinado): antes dos módulos autenticados
  .use(authModule)
  .use(tenantsModule)
  .use(sectorsModule)
  .use(usersModule)
  .use(rolesModule)
  .use(categoriesModule)
  .use(identifiersModule)
  .use(documentsModule)
  .use(providerModule)
  .use(plansModule)
  .use(subscriptionsModule)

  .use(approvalsModule)
  .use(auditModule)
  .use(statsModule)
  .use(devicesModule)
  .use(classifierModule)
  .use(emailModule)
  .use(platformModule)
  .use(notificationSSEModule)
  .onError((ctx: any) => {
    const { code, error, set, request } = ctx;
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: { code: "NOT_FOUND", message: "Rota não encontrada." } };
    }
    if (code === "VALIDATION") {
      set.status = 422;
      return { error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } };
    }
    const start = requestTimings.get(request);
    const url = new URL(request.url);
    logger.error({
      code,
      method: request.method,
      path: url.pathname,
      status: set.status,
      durationMs: start ? Math.round(performance.now() - start) : undefined,
      err: error,
    });
    requestTimings.delete(request);
    set.status = 500;
    return { error: { code: "INTERNAL_ERROR", message: "Erro interno do servidor." } };
  })
  // O proxy do cPanel/LiteSpeed faz proxy para 127.0.0.1:3000 — não expõe a porta na rede.
  .listen({ port: PORT, hostname: "127.0.0.1" });

logger.info(`DocID API arrancou em http://localhost:${PORT}`);

void startWorkers().catch((err) => {
  logger.warn({ err }, "[BULLMQ] Falha ao arrancar workers");
});

// Fila de e-mails em PostgreSQL: não depende do Redis.
startEmailWorker();

export type App = typeof app;
