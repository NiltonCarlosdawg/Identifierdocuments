import { describe, expect, test } from "bun:test";
import {
  NETWORK_ERROR_MESSAGE,
  mapError,
  statusMessage,
  friendlyRole,
  friendlyStatus,
  friendlyMime,
  friendlyLicenseState,
  friendlySubscription,
  friendlyPlan,
} from "../shared/errors/mapError";

describe("textos amigáveis", () => {
  test("sem ligação fala do servidor, não da API", () => {
    expect(NETWORK_ERROR_MESSAGE).toBe("Sem ligação ao servidor. Verifique a ligação e tente novamente.");
    expect(mapError(new Error("Failed to fetch"))).toBe(NETWORK_ERROR_MESSAGE);
  });

  test("respostas com problema viram frases, sem códigos", () => {
    for (const code of [400, 401, 403, 404, 409, 422, 429, 500, 502, 503]) {
      expect(statusMessage(code)).not.toMatch(/\d/);
    }
    expect(mapError(new Error("Erro 429"), "Não foi possível guardar.")).toBe("Não foi possível guardar.");
    expect(mapError(new Error("422 Unprocessable Entity"), "Não foi possível guardar.")).toBe("Não foi possível guardar.");
  });

  test("mapError mantém mensagens escritas para pessoas", () => {
    const uploadHint = "Para enviar ficheiros sem ligação, use a aplicação instalada no computador.";
    expect(mapError(new Error(uploadHint), "Tente novamente.")).toBe(uploadHint);
    expect(mapError(new Error("Este identificador já possui um documento principal."), "Tente novamente."))
      .toBe("Este identificador já possui um documento principal.");
    expect(mapError(new Error("ORG_ADMIN"), "Não foi possível concluir.")).toBe("Não foi possível concluir.");
    expect(mapError(new Error("category_id inválido"), "Não foi possível concluir.")).toBe("Não foi possível concluir.");
  });

  test("funções de acesso", () => {
    expect(friendlyRole("ORG_ADMIN")).toBe("Administrador");
    expect(friendlyRole("MEMBER")).toBe("Membro");
    expect(friendlyRole("SECTOR_SUPERVISOR")).toBe("Supervisor de sector");
    expect(friendlyRole("OUTRO_ESTADO")).toBe("Função de acesso");
  });

  test("estados e tipos de ficheiro", () => {
    expect(friendlyStatus("active")).toBe("Activo");
    expect(friendlyStatus("cancelled")).toBe("Cancelado");
    expect(friendlyStatus("qualquer_coisa")).toBe("Por confirmar");
    expect(friendlyStatus(null)).toBe("—");
    expect(friendlyMime("application/pdf")).toBe("PDF");
    expect(friendlyMime("image/png")).toBe("PNG");
    expect(friendlyMime("application/estranho")).toBe("Ficheiro");
  });

  test("licença e plano", () => {
    expect(friendlyLicenseState("active")).toBe("Activa");
    expect(friendlyLicenseState("grace")).toBe("Em tolerância");
    expect(friendlyLicenseState("expired")).toBe("Expirada");
    expect(friendlyLicenseState("suspended")).toBe("Suspensa");
    expect(friendlyLicenseState("trial")).toBe("Teste");
    expect(friendlySubscription("free")).toBe("Teste");
    expect(friendlySubscription("paid")).toBe("Activa");
    expect(friendlyPlan("free")).toBe("Teste");
    expect(friendlyPlan("Profissional")).toBe("Profissional");
  });
});
