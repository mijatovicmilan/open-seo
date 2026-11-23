// Sending one approved outreach email from the app (fork feature): a plain
// text message from "<sender name> <sender email>" with the project's
// signature, sent over SMTP with implicit TLS (port 465) through Cloudflare's
// socket API, which works on Workers and in the local workerd runtime.
//
// The SMTP user and password come only from the environment
// (OUTREACH_<KEY>_SMTP_USER / OUTREACH_<KEY>_SMTP_PASSWORD, where KEY is the
// project's mail env key). They are never stored, logged or returned, and
// SMTP errors are reported without them.

import { env } from "cloudflare:workers";
import type { OutreachConfig } from "@/server/features/outreach/outreachDomain";

const SMTP_TIMEOUT_MS = 20_000;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/u;
const ASCII = /^[\x20-\x7e]*$/u;

type MailCredentials = { user: string; password: string };

function envValue(name: string) {
  const value: unknown = Reflect.get(env, name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mailEnvNames(key: string) {
  const prefix = `OUTREACH_${key.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}`;
  return { user: `${prefix}_SMTP_USER`, password: `${prefix}_SMTP_PASSWORD` };
}

function credentialsFor(key: string): MailCredentials | null {
  if (!key) return null;
  const names = mailEnvNames(key);
  const user = envValue(names.user);
  const password = envValue(names.password);
  return user && password ? { user, password } : null;
}

// Why the app cannot send for this project right now, or null when it can.
export function mailProblem(config: OutreachConfig): string | null {
  if (!config.senderEmail || !EMAIL.test(config.senderEmail)) {
    return "Set the sender email in outreach settings.";
  }
  if (!config.senderName) return "Set the sender name in outreach settings.";
  if (!config.signature) return "Set the signature in outreach settings.";
  if (!config.smtpHost) return "Set the SMTP host in outreach settings.";
  if (!config.mailEnvKey) return "Set the mail env key in outreach settings.";
  if (!credentialsFor(config.mailEnvKey)) {
    const names = mailEnvNames(config.mailEnvKey);
    return `The server has no ${names.user} and ${names.password} values.`;
  }
  return null;
}

function base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// RFC 2047 encoded words for a non-ASCII header, split on whole characters.
function encodeHeader(value: string) {
  if (ASCII.test(value)) return value;
  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (encoder.encode(chunk + char).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?utf-8?b?${base64(word)}?=`).join("\r\n ");
}

function rfc5322Date(date: Date) {
  return date.toUTCString().replace("GMT", "+0000");
}

export function outreachMessageId(senderEmail: string) {
  const domain = senderEmail.split("@")[1] ?? "localhost";
  const random = crypto.randomUUID().replaceAll("-", "");
  return `<${Date.now()}.${random}@${domain}>`;
}

export function buildOutreachMail(input: {
  config: OutreachConfig;
  to: string;
  subject: string;
  body: string;
  messageId: string;
  date: Date;
  inReplyTo?: string | null;
}) {
  const to = input.to.trim();
  if (!EMAIL.test(to)) {
    throw new Error("the recipient is not a valid email address");
  }
  const subject = input.subject.replace(/[\r\n]+/gu, " ").trim();
  const body = input.body.replace(/\r\n?/gu, "\n");
  const lines = body.split("\n");
  const plain = lines.every((line) => ASCII.test(line) && line.length <= 78);
  const encoded = plain
    ? lines.join("\r\n")
    : (base64(body).match(/.{1,76}/gu) ?? []).join("\r\n");
  const headers = [
    `From: ${encodeHeader(input.config.senderName)} <${input.config.senderEmail}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${rfc5322Date(input.date)}`,
    `Message-ID: ${input.messageId}`,
    ...(input.inReplyTo
      ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`]
      : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    `Content-Transfer-Encoding: ${plain ? "7bit" : "base64"}`,
  ];
  return `${headers.join("\r\n")}\r\n\r\n${encoded}\r\n`;
}

type Reply = { code: number; text: string };

type SmtpSession = {
  command: (line: string) => Promise<void>;
  write: (text: string) => Promise<void>;
  expect: (step: string, codes: number[]) => Promise<Reply>;
  next: () => Promise<Reply>;
};

// A minimal SMTP client over implicit TLS: greeting, EHLO and AUTH PLAIN,
// then the caller's steps, then QUIT.
async function withSmtpSession(
  config: OutreachConfig,
  steps: (session: SmtpSession) => Promise<void>,
) {
  const credentials = credentialsFor(config.mailEnvKey);
  if (!credentials) throw new Error("no SMTP credentials on the server");
  const { connect } = await import("cloudflare:sockets");
  const socket = connect(
    { hostname: config.smtpHost, port: config.smtpPort },
    { secureTransport: "on", allowHalfOpen: false },
  );
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let lines: string[] = [];

  const withTimeout = <T>(promise: Promise<T>) =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("the mail server did not answer in time")),
          SMTP_TIMEOUT_MS,
        ),
      ),
    ]);

  const next = async (): Promise<Reply> => {
    for (;;) {
      const end = buffer.indexOf("\r\n");
      if (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        lines.push(line);
        if (/^\d{3}(?: |$)/u.test(line)) {
          const reply = {
            code: Number(line.slice(0, 3)),
            text: lines.join(" ").slice(0, 300),
          };
          lines = [];
          return reply;
        }
        continue;
      }
      const result: { done: boolean; value?: unknown } = await withTimeout(
        reader.read(),
      );
      if (result.done || !(result.value instanceof Uint8Array)) {
        throw new Error("the mail server closed the connection");
      }
      buffer += decoder.decode(result.value, { stream: true });
    }
  };
  const expect = async (step: string, codes: number[]) => {
    const reply = await next();
    if (!codes.includes(reply.code)) {
      throw new Error(`${step} refused: ${reply.text}`);
    }
    return reply;
  };
  const write = (text: string) =>
    withTimeout(writer.write(encoder.encode(text)));
  const command = (line: string) => write(`${line}\r\n`);

  try {
    await expect("greeting", [220]);
    const domain = config.senderEmail.split("@")[1] ?? "localhost";
    await command(`EHLO ${domain}`);
    await expect("EHLO", [250]);
    await command(
      `AUTH PLAIN ${base64(`\u0000${credentials.user}\u0000${credentials.password}`)}`,
    );
    await expect("login", [235]);
    await steps({ command, write, expect, next });
    await command("QUIT");
    await next().catch(() => undefined);
  } finally {
    await socket.close().catch(() => undefined);
  }
}

export async function sendOutreachMail(input: {
  config: OutreachConfig;
  to: string;
  raw: string;
}) {
  await withSmtpSession(input.config, async ({ command, write, expect }) => {
    await command(`MAIL FROM:<${input.config.senderEmail}>`);
    await expect("sender", [250]);
    await command(`RCPT TO:<${input.to}>`);
    await expect("recipient", [250, 251]);
    await command("DATA");
    await expect("DATA", [354]);
    // Dot-stuffing: a line that starts with "." gets a second one.
    await write(
      `${input.raw.replace(/\r\n\./gu, "\r\n..").replace(/^\./u, "..")}\r\n.\r\n`,
    );
    await expect("message", [250]);
  });
}

// Logs in and out again without sending anything, so the owner can check
// the settings and the server's credentials.
export async function testMailConnection(config: OutreachConfig) {
  await withSmtpSession(config, async () => undefined);
}
