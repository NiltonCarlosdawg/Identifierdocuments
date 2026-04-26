import { Elysia, t } from "elysia";
import { sqlite } from "../db";

export const categoriesModule = new Elysia({ prefix: "/categories" })

  // Listar todas as categorias
  .get("/", () => {
    const rows = sqlite.prepare(`
      SELECT *, grp AS "group" FROM document_categories ORDER BY grp, name
    `).all();

    // Agrupa por grupo
    const grouped: Record<string, any[]> = {};
    for (const row of rows as any[]) {
      const g = row.grp;
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(row);
    }

    return {
      total: rows.length,
      groups: grouped,
    };
  }, {
    detail: {
      summary: "Listar todas as categorias de documentos",
      tags: ["Categorias"],
    },
  })

  // Obter uma categoria por ID
  .get("/:id", ({ params, error }) => {
    const row = sqlite.prepare(
      "SELECT *, grp AS 'group' FROM document_categories WHERE id = ?"
    ).get(params.id);
    if (!row) return error(404, { message: `Categoria '${params.id}' não encontrada.` });
    return row;
  }, {
    params: t.Object({ id: t.String() }),
    detail: {
      summary: "Obter categoria por ID",
      tags: ["Categorias"],
    },
  });
