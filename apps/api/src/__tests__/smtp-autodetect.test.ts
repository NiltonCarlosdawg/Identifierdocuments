import { describe, expect, it } from "bun:test";
import { candidateServers, detectSmtp, type SmtpCandidate } from "../services/email/smtp-autodetect";

const authError = () => Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });
const timeout = () => Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" });

describe("descoberta do servidor SMTP", () => {
  it("reconhece o Google e o Microsoft 365 pelo MX", () => {
    expect(candidateServers("empresa.ao", ["aspmx.l.google.com."]).candidates[0]).toMatchObject({ host: "smtp.gmail.com", port: 465, security: "ssl" });
    expect(candidateServers("empresa.ao", ["empresa-ao.mail.protection.outlook.com"]).candidates[0]).toMatchObject({ host: "smtp.office365.com", port: 587 });
    expect(candidateServers("gmail.com", []).provider).toBe("Google");
  });

  it("alojamento próprio: experimenta mail. e smtp. do domínio, 465 antes de 587", () => {
    const { provider, candidates } = candidateServers("milvendas.ao", ["mail.milvendas.ao."]);
    expect(provider).toBeNull();
    expect(candidates.slice(0, 4).map((c) => `${c.host}:${c.port}`)).toEqual([
      "mail.milvendas.ao:465", "mail.milvendas.ao:587", "smtp.milvendas.ao:465", "smtp.milvendas.ao:587",
    ]);
    expect(new Set(candidates.map((c) => `${c.host}:${c.port}`)).size).toBe(candidates.length); // sem repetidos
  });

  it("devolve o primeiro servidor que aceita o login", async () => {
    const tried: string[] = [];
    const verify = async (c: SmtpCandidate) => {
      tried.push(`${c.host}:${c.port}`);
      if (c.port === 465) throw timeout();
    };
    const r = await detectSmtp("docid@milvendas.ao", "x", { verify, mx: async () => [] });
    expect(r).toMatchObject({ ok: true, host: "mail.milvendas.ao", port: 587, security: "starttls" });
    expect(tried).toEqual(["mail.milvendas.ao:465", "mail.milvendas.ao:587"]);
  });

  it("pára na primeira recusa de login (não insiste com a palavra-passe noutros servidores)", async () => {
    let calls = 0;
    const r = await detectSmtp("ana@empresa.ao", "errada", { verify: async () => { calls++; throw authError(); }, mx: async () => ["aspmx.l.google.com"] });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "AUTH_FAILED" });
    expect(calls).toBe(1);
    if (r.ok === false) expect(r.hint).toContain("palavra-passe de aplicação");
  });

  it("sem servidor que responda: pede a configuração manual", async () => {
    const r = await detectSmtp("ana@empresa.ao", "x", { verify: async () => { throw timeout(); }, mx: async () => { throw new Error("ENOTFOUND"); } });
    expect(r).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });
});
