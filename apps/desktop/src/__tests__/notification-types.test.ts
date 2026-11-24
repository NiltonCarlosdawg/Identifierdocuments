import { describe, it, expect } from "bun:test";
import { notificationLabel } from "../interfaces/hooks/useNotifications";

describe("tipos de notificação SSE", () => {
  it("traduz os tipos emitidos pelo servidor que ainda não tinham etiqueta", () => {
    expect(notificationLabel("access:requested")).toBe("Pedido de acesso");
    expect(notificationLabel("access:granted")).toBe("Acesso concedido");
    expect(notificationLabel("access:rejected")).toBe("Acesso negado");
    expect(notificationLabel("document:share_revoked")).toBe("Partilha revogada");
  });

  it("mantém etiquetas já existentes e usa o tipo cru como fallback", () => {
    expect(notificationLabel("document:shared")).toBe("Documento partilhado consigo");
    expect(notificationLabel("desconhecido:evento")).toBe("desconhecido:evento");
  });
});
