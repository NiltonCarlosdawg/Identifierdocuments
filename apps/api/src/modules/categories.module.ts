import { Elysia, t } from "elysia";
import { db } from "../db";
import { categories } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { withTenant } from "../db/withTenant";

export const categoriesModule = new Elysia({ prefix: "/categories" })
  .use(requireAuth())

  .get("/", async ({ tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query.categories.findMany({ orderBy: (c) => [c.group, c.name] });
      const grouped: Record<string, any[]> = {};
      for (const row of rows) {
        if (!grouped[row.group]) grouped[row.group] = [];
        grouped[row.group].push(row);
      }
      return { data: { total: rows.length, groups: grouped } };
    });
  }, {
    detail: { summary: "Listar categorias", tags: ["Categorias"] },
  })

  .get("/:id", async ({ params, set, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      const row = await tx.query.categories.findFirst({ where: eq(categories.id, params.id) });
      if (!row) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Categoria não encontrada." } }; }
      return { data: row };
    });
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Obter categoria por ID", tags: ["Categorias"] },
  });
