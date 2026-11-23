import { z } from "zod";

// Input schemas for outreach (fork feature). Shared by server functions and
// MCP tools so both refuse the same input.

export const outreachNumberSchema = z
  .number()
  .int()
  .min(1)
  .max(1_000_000)
  .describe("The prospect's number in this project (#12 is 12).");

export const outreachStatusSchema = z.enum([
  "drafted",
  "awaiting approval",
  "approved",
  "sent",
  "follow-up sent",
  "replied",
  "linked",
  "declined",
  "no reply",
  "dropped",
]);

export const outreachLinkRelSchema = z.enum([
  "follow",
  "nofollow",
  "ugc",
  "sponsored",
]);

export const outreachMoveSchema = z.enum(["drop", "decline", "reopen", "keep"]);

export const outreachChannelSchema = z.enum(["email", "form"]);

export const outreachSettingsInputSchema = z.object({
  siteUrl: z.string().trim().max(300),
  linkDomains: z.string().trim().max(500),
  senderName: z.string().trim().max(120),
  senderEmail: z.union([z.literal(""), z.string().trim().email().max(200)]),
  signature: z.string().max(500),
  smtpHost: z.string().trim().max(200),
  smtpPort: z.number().int().min(1).max(65_535),
  mailEnvKey: z.string().trim().max(40),
  timeZone: z.string().trim().min(1).max(60),
  dailyMin: z.number().int().min(0).max(100),
  dailyMax: z.number().int().min(0).max(100),
  weeklyMin: z.number().int().min(0).max(500),
  weeklyMax: z.number().int().min(0).max(500),
  followUpDays: z.number().int().min(1).max(60),
  scheduleTimeZone: z.string().trim().min(1).max(60),
  scheduleDays: z.array(z.number().int().min(1).max(7)).max(7),
  scheduleTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  scheduleWindowMinutes: z.number().int().min(15).max(720),
});
