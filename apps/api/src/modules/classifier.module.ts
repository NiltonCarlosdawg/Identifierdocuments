import { Elysia, t } from "elysia";
import { requireAuth } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { suggestCategory } from "../services/classifier.service";
import { db } from "../db";
import { categories } from "../db/schema";
import { withTenant } from "../db/withTenant";

export const classifierModule = new Elysia({ prefix: "/classifier" })
  .use(requireAuth())

  .post("/suggest", async ({ auth, body, set, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      try {
        const allowed = await checkRateLimit(`classifier:${auth!.userId}`, 10, 60_000);
        if (!allowed) {
          set.status = 429;
          return { error: { code: "RATE_LIMITED", message: "Muitos pedidos ao classificador. Tente novamente dentro de 1 minuto." } };
        }
        const result = await suggestCategory(body.text, body.filename);

        if (result.categoryId === "UNKNOWN") {
          return { data: { ...result, availableCategories: await tx.query.categories.findMany() } };
        }

        const category = await tx.query.categories.findFirst({
          where: (cats, { eq }) => eq(cats.id, result.categoryId),
        });

        return {
          data: {
            categoryId: result.categoryId,
            categoryName: category?.name || null,
            group: category?.group || null,
            confidence: result.confidence,
            reasoning: result.reasoning,
          },
        };
      } catch (err: any) {
        set.status = 400;
        return { error: { code: "CLASSIFIER_ERROR", message: err.message } };
      }
    });
  }, {
    body: t.Object({
      text: t.String({ minLength: 10 }),
      filename: t.Optional(t.String()),
    }),
    detail: { summary: "Sugerir categoria por IA", tags: ["Classificador"] },
  });
