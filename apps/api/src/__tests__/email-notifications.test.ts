import { describe, it, expect, beforeAll } from "bun:test";
import { randomBytes } from "node:crypto";

process.env.JWT_SECRET ??= "test-secret-com-pelo-menos-32-caracteres!!";
process.env.EMAIL_SECRETS_KEY ??= randomBytes(32).toString("base64");

let box: typeof import("../lib/secret-box");
let link: typeof import("../lib/signed-link");
let guard: typeof import("../lib/smtp-guard");
let tpl: typeof import("../services/email/templates");
let transport: typeof import("../services/email/transport");
let worker: typeof import("../jobs/email-worker");
let svc: typeof import("../services/email/tenant-email.service");

beforeAll(async () => {
  box = await import("../lib/secret-box");
  link = await import("../lib/signed-link");
  guard = await import("../lib/smtp-guard");
  tpl = await import("../services/email/templates");
  transport = await import("../services/email/transport");
  worker = await import("../jobs/email-worker");
  svc = await import("../services/email/tenant-email.service");
});

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

describe("secret-box (credenciais encriptadas)", () => {
  it("encripta e desencripta no mesmo tenant", () => {
    const enc = box.encryptSecret("p@ss-smtp", TENANT_A);
    expect(enc).not.toContain("p@ss-smtp");
    expect(box.decryptSecret(enc, TENANT_A)).toBe("p@ss-smtp");
  });
  it("o mesmo valor dá cifras diferentes (IV aleatório)", () => {
    expect(box.encryptSecret("x", TENANT_A)).not.toBe(box.encryptSecret("x", TENANT_A));
  });
  it("um segredo copiado para outro tenant não desencripta", () => {
    const enc = box.encryptSecret("p@ss", TENANT_A);
    expect(() => box.decryptSecret(enc, TENANT_B)).toThrow();
  });
  it("cifra adulterada é rejeitada", () => {
    const enc = box.encryptSecret("p@ss", TENANT_A);
    const parts = enc.split(".");
    parts[3] = Buffer.from("outra-coisa").toString("base64url");
    expect(() => box.decryptSecret(parts.join("."), TENANT_A)).toThrow();
  });
});

describe("links de download assinados", () => {
  const claims = { t: TENANT_A, d: "doc-1", u: "user-1" };
  it("token válido devolve os dados", () => {
    expect(link.verifyDownloadToken(link.createDownloadToken(claims))).toMatchObject(claims);
  });
  it("token expirado é rejeitado", () => {
    const old = link.createDownloadToken(claims, 1000);
    expect(link.verifyDownloadToken(old)).toBeNull();
  });
  it("token alterado (outro documento) é rejeitado", () => {
    const tok = link.createDownloadToken(claims);
    const [, sig] = tok.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, d: "doc-2", e: 9_999_999_999 })).toString("base64url");
    expect(link.verifyDownloadToken(`${forged}.${sig}`)).toBeNull();
  });
});

describe("protecção SSRF do SMTP do tenant", () => {
  it("bloqueia endereços internos e reservados", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(guard.isPrivateAddress(ip)).toBe(true);
    }
    expect(guard.isPrivateAddress("8.8.8.8")).toBe(false);
  });
  it("recusa portas que não são SMTP e IPs internos", async () => {
    await expect(guard.resolveSafeSmtpHost("8.8.8.8", 6379)).rejects.toThrow();
    await expect(guard.resolveSafeSmtpHost("127.0.0.1", 587)).rejects.toThrow();
    expect(await guard.resolveSafeSmtpHost("8.8.8.8", 587)).toBe("8.8.8.8");
  });
});

describe("templates", () => {
  const base = {
    tenantName: "Empresa A", recipientName: "Ana", documentIdentifier: "EA-PROP-2026-1123-001",
    documentTitle: "Proposta <script>alert(1)</script>", approverName: "João & Filhos",
    approvedAt: "2026-11-23T13:30:00Z", link: "https://didall.milvendas.ao/email-links/download?token=abc",
  };
  it("aprovação: escapa variáveis e mostra os dados pedidos", () => {
    const r = tpl.renderDocumentApproved(base);
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("João &amp; Filhos");
    expect(r.html).toContain("23/11/2026 às 14h30"); // Luanda = UTC+1
    expect(r.html).toContain(base.link.replace(/&/g, "&amp;"));
    expect(r.text).toContain("Aprovado por: João & Filhos");
    expect(r.subject).toContain("EA-PROP-2026-1123-001");
  });
  it("envio: remetente, resumo e link; sem link mostra instrução da app", () => {
    const shared = {
      tenantName: "Empresa A", recipientName: "Rui", senderName: "Ana", documentIdentifier: "X-1",
      documentTitle: "Contrato", summary: "Contrato de prestação de serviços", sharedAt: "2026-11-23T08:00:00Z",
      sectorName: null, link: "https://exemplo.ao/x",
    };
    const r = tpl.renderDocumentShared(shared);
    expect(r.subject).toBe("Ana enviou-lhe um documento: Contrato");
    expect(r.html).toContain("Contrato de prestação de serviços");
    expect(r.html).toContain("https://exemplo.ao/x");
    const noLink = tpl.renderDocumentShared({ ...shared, link: null });
    expect(noLink.html).toContain("Abra a aplicação DocID");
  });
  it("rejeita links javascript: e quebras de linha no assunto", () => {
    const r = tpl.renderDocumentApproved({ ...base, link: "javascript:alert(1)", documentTitle: "A\r\nBcc: x@y.z" });
    expect(r.html).not.toContain("javascript:");
    expect(r.subject).not.toMatch(/[\r\n]/);
  });
});

describe("transporte", () => {
  it("valida e-mails e limpa o nome do remetente", () => {
    expect(transport.isValidEmail("notificacoes@empresaA.com")).toBe(true);
    expect(transport.isValidEmail("a@b")).toBe(false);
    expect(transport.isValidEmail("x@y.com\r\nBcc: z@w.com")).toBe(false);
    expect(transport.formatAddress('Empresa "A"\r\n', "n@a.com")).toBe('"Empresa A" <n@a.com>');
  });
  it("destinatário inválido é erro definitivo (sem novas tentativas)", async () => {
    const sender = { source: "tenant", provider: "resend", fromEmail: "a@b.com", fromName: "A", apiKey: "k" } as const;
    try {
      await transport.sendEmail(sender as any, { to: "invalido", subject: "s", html: "h", text: "t" });
      throw new Error("devia falhar");
    } catch (err: any) {
      expect(err).toBeInstanceOf(transport.EmailSendError);
      expect(err.permanent).toBe(true);
    }
  });
});

describe("política de tentativas", () => {
  it("espera exponencial com tecto de 6 h", () => {
    expect([1, 2, 3, 4, 5, 9].map(worker.backoffSeconds)).toEqual([60, 300, 1500, 7500, 21600, 21600]);
  });
  it("falha temporária volta à fila; definitiva ou esgotada fica failed", () => {
    const now = 1_000_000;
    expect(worker.nextStateAfterFailure(1, 5, false, now)).toEqual({ status: "queued", nextAttemptAt: new Date(now + 60_000) });
    expect(worker.nextStateAfterFailure(2, 5, true, now).status).toBe("failed");
    expect(worker.nextStateAfterFailure(5, 5, false, now).status).toBe("failed");
  });
});

describe("preferências do utilizador", () => {
  it("respeita opt-out global e por evento", () => {
    expect(svc.wantsEmail(null, "document_shared")).toBe(true);
    expect(svc.wantsEmail({ email: false }, "document_shared")).toBe(false);
    expect(svc.wantsEmail({ email_document_shared: false }, "document_shared")).toBe(false);
    expect(svc.wantsEmail({ email_document_shared: false }, "document_approved")).toBe(true);
  });
});

describe("avisos de acções que pedem atenção", () => {
  const base = {
    tenantName: "Org <b>X</b>", recipientName: "Ana", title: "Um documento aguarda a sua aprovação",
    subject: "Aprovação pendente:\r\nBcc: x@y.z", badge: "Aprovação pendente", tone: "warning" as const,
    intro: ["<script>alert(1)</script> quer enviar um documento."],
    rows: [["Documento", "<img src=x onerror=1>"]] as Array<[string, string]>,
    note: { label: "Motivo", text: "<i>fora do prazo</i>" },
    action: "Abra a aplicação DocID.", at: "2026-11-27T10:05:00Z",
  };

  it("todos os novos tipos usam o template genérico", () => {
    for (const ev of ["approval_requested", "access_requested", "document_rejected", "password_changed",
      "role_granted", "device_registered", "identifier_cancelled"]) {
      const r = tpl.renderEmail(ev, base as unknown as Record<string, unknown>);
      expect(r.html).toContain("Um documento aguarda a sua aprovação");
    }
  });

  it("escapa todas as variáveis e limpa o assunto", () => {
    const r = tpl.renderAttention(base);
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("<img src=x");
    expect(r.html).not.toContain("<i>fora");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.text).toContain("Motivo: <i>fora do prazo</i>"); // texto simples não é HTML
    expect(r.text).toContain("Data e hora: 27/11/2026 às 11h05");
  });

  it("só mostra o botão com um link http(s)", () => {
    expect(tpl.renderAttention({ ...base, link: "javascript:alert(1)" }).html).not.toContain("javascript:");
    expect(tpl.renderAttention({ ...base, link: "https://api.exemplo.ao/x" }).html).toContain("https://api.exemplo.ao/x");
  });

  it("o aviso de password alterada sai mesmo com os e-mails desligados", () => {
    expect(svc.wantsEmail({ email: false }, "password_changed")).toBe(true);
    expect(svc.wantsEmail({ email: false }, "device_registered")).toBe(false);
    expect(svc.wantsEmail({ email_approval_requested: false }, "approval_requested")).toBe(false);
    expect(svc.wantsEmail({ email_approval_requested: false }, "access_requested")).toBe(true);
  });
});
