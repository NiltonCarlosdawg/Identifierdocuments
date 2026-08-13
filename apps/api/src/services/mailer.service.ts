import nodemailer from "nodemailer";
import { logger } from "../lib/logger";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "DocID <no-reply@docid.local>";
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const IS_PROD = process.env.NODE_ENV === "production";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      connectionTimeout: 5000,
      socketTimeout: 5000,
    });
  }
  return transporter;
}

export function isSmtpConfigured(): boolean {
  return Boolean(SMTP_HOST);
}

export async function sendInviteEmail(to: string, fullName: string, orgName: string, password: string): Promise<boolean> {
  const t = getTransporter();
  const bodyText =
    `Olá ${fullName},\n\n` +
    `Foi convidado para a organização "${orgName}" no DocID.\n\n` +
    `Email: ${to}\n` +
    `Password temporária: ${password}\n\n` +
    `Altere a password no primeiro acesso (Perfil).\n`;
  if (!t) {
    logger.warn({ to }, "SMTP não configurado — convite não enviado por email.");
    // Nunca imprimir password em produção
    if (!IS_PROD) {
      logger.info(`Convite para ${to}: password temporária ${password}`);
    }
    return false;
  }
  await t.sendMail({
    from: SMTP_FROM,
    to,
    subject: `DocID — Convite para ${orgName}`,
    text: bodyText,
    html: `<p>Olá ${fullName},</p>` +
      `<p>Foi convidado para a organização <strong>${orgName}</strong> no DocID.</p>` +
      `<p>Email: <strong>${to}</strong><br/>Password temporária: <strong>${password}</strong></p>` +
      `<p>Altere a password no primeiro acesso (Perfil).</p>`,
  });
  return true;
}

export async function sendResetPasswordEmail(to: string, token: string): Promise<void> {
  const t = getTransporter();
  if (!t) {
    logger.warn({ to }, "SMTP não configurado — reset não enviado por email.");
    if (!IS_PROD) {
      logger.info(`Reset token para ${to}: ${token}`);
    }
    return;
  }
  await t.sendMail({
    from: SMTP_FROM,
    to,
    subject: "DocID — Repor password",
    text: `Recebemos um pedido para repor a password da sua conta DocID.\n\n` +
      `O seu código de redefinição é:\n\n${token}\n\n` +
      `Este código expira em 15 minutos e só pode ser usado uma vez.\n\n` +
      `Se não foi você que pediu, ignore este email.`,
    html: `<p>Recebemos um pedido para repor a password da sua conta DocID.</p>` +
      `<p>O seu código de redefinição é:</p>` +
      `<p style="font-size:20px;font-weight:bold;letter-spacing:2px">${token}</p>` +
      `<p>Este código expira em <strong>15 minutos</strong> e só pode ser usado uma vez.</p>` +
      `<p>Se não foi você que pediu, ignore este email.</p>`,
  });
}
