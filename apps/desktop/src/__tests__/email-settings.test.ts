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
