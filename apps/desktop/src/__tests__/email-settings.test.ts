import { describe, it, expect } from "bun:test";
import { emailSettingsPayload, type EmailForm } from "../interfaces/pages/Settings";

const base: EmailForm = {
  provider: "smtp", fromEmail: "  provedor@empresa.ao ", fromName: " Empresa ", replyTo: "",
  smtpHost: "smtp.empresa.ao", smtpPort: "587", smtpSecurity: "starttls", smtpUser: " user ",
  secret: "", enabled: true,
};

describe("configuração de e-mail na app", () => {
  it("envia os campos SMTP e omite o segredo quando não mudou", () => {
    const p = emailSettingsPayload(base);
    expect(p).toMatchObject({ provider: "smtp", fromEmail: "provedor@empresa.ao", smtpHost: "smtp.empresa.ao", smtpPort: 587, smtpSecurity: "starttls", smtpUser: "user", enabled: true });
    expect("secret" in p).toBe(false);
  });
  it("inclui o segredo quando foi escrito", () => {
    expect(emailSettingsPayload({ ...base, secret: "chave" })).toMatchObject({ secret: "chave" });
  });
  it("não envia campos SMTP quando o fornecedor é de API", () => {
    const p = emailSettingsPayload({ ...base, provider: "resend", secret: "chave" });
    expect(p).toMatchObject({ provider: "resend", secret: "chave" });
    expect("smtpHost" in p).toBe(false);
    expect("smtpPort" in p).toBe(false);
  });
});

import { friendlyMessage } from "../shared/errors/mapError";

describe("mensagens da configuração rápida", () => {
  it("as dicas da API chegam ao utilizador (não são trocadas pela mensagem genérica)", () => {
    for (const msg of [
      "O servidor de e-mail recusou o e-mail ou a palavra-passe. Confirme a palavra-passe da caixa. Nas contas Microsoft da empresa, o envio autenticado tem de estar activo para esta caixa (centro de administração › Utilizadores › Correio › Aplicações de e-mail).",
      "O servidor de e-mail recusou o e-mail ou a palavra-passe. Confirme a palavra-passe da caixa. No Gmail e no Google Workspace use uma \"palavra-passe de aplicação\" (Conta Google › Segurança › Palavras-passe de aplicações), não a palavra-passe normal.",
      "Não encontrámos o servidor de envio de empresa.ao. Use a configuração manual com os dados do seu fornecedor de e-mail.",
    ]) expect(friendlyMessage(msg, "GENÉRICA")).toBe(msg);
  });
});
