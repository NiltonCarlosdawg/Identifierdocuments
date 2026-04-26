import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { initDatabase } from "./db";
import { categoriesModule }  from "./modules/categories.module";
import { identifiersModule } from "./modules/identifiers.module";
import { documentsModule }   from "./modules/documents.module";
import { auditModule }       from "./modules/audit.module";
import { statsModule }       from "./modules/stats.module";

// ── Inicializa a base de dados e faz seed das categorias ──────────────────
initDatabase();

// ── Aplicação principal ───────────────────────────────────────────────────
const app = new Elysia()

  .use(cors())

  .use(swagger({
    documentation: {
      info: {
        title:       "Verano Labs — API de Gestão de Identificadores",
        version:     "1.0.0",
        description:
          "API para geração, consulta e validação de identificadores únicos de documentos empresariais. " +
          "Suporta todas as categorias de documentos que uma empresa emite: " +
          "comerciais, financeiros, jurídicos, RH, administrativos e técnicos.",
        contact: {
          name:  "Verano Labs",
          email: "geralverano@verano.sbs",
        },
      },
      tags: [
        { name: "Categorias",    description: "Categorias de documentos disponíveis" },
        { name: "Identificadores", description: "Geração e consulta de identificadores únicos" },
        { name: "Documentos",    description: "Associação e download de documentos" },
        { name: "Auditoria",     description: "Log de todas as operações" },
        { name: "Estatísticas",  description: "Métricas e dashboard" },
      ],
      servers: [{ url: "http://localhost:3000", description: "Desenvolvimento" }],
    },
    path: "/docs",
  }))

  // ── Health check ─────────────────────────────────────────────────────────
  .get("/", () => ({
    name:    "Verano Labs — DocID API",
    version: "1.0.0",
    status:  "online",
    docs:    "/docs",
  }), {
    detail: { summary: "Health check", tags: ["Sistema"] },
  })

  // ── Módulos ───────────────────────────────────────────────────────────────
  .use(categoriesModule)
  .use(identifiersModule)
  .use(documentsModule)
  .use(auditModule)
  .use(statsModule)

  // ── Erro global ───────────────────────────────────────────────────────────
  .onError(({ code, error, set }) => {
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { success: false, message: "Rota não encontrada." };
    }
    if (code === "VALIDATION") {
      set.status = 422;
      return { success: false, message: "Dados inválidos.", details: error.message };
    }
    set.status = 500;
    console.error("[ERROR]", error);
    return { success: false, message: "Erro interno do servidor." };
  })

  .listen(3000);

console.log(`
  ╔════════════════════════════════════════════╗
  ║     Verano Labs — DocID API v1.0.0         ║
  ║     http://localhost:3000                  ║
  ║     Swagger: http://localhost:3000/docs    ║
  ╚════════════════════════════════════════════╝
`);

export type App = typeof app;
