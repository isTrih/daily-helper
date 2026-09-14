import { z } from "zod";

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value === undefined || !["0", "false", "no", "off"].includes(value.toLowerCase()));

const envSchema = z.object({
  LARK_APP_ID: z.string().trim().optional(),
  LARK_APP_SECRET: z.string().trim().optional(),
  LARK_DEFAULT_CHAT_ID: z.string().trim().optional(),
  LARK_LONG_CONNECTION_ENABLED: booleanFromEnv,
  XINGTU_API_BASE: z.string().url().default("https://autoxingtu.api.ali.trih.top"),
  XINGTU_API_TOKEN: z.string().trim().optional(),
  PROJECT_ORDER: z.string().trim().default(""),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  AUTO_DAILY_REPORT_ENABLED: booleanFromEnv,
  DAILY_REPORT_CRON: z.string().trim().default("0 9 * * *"),
  REPORT_TIMEZONE: z.string().trim().default("Asia/Shanghai"),
});

export type AppConfig = ReturnType<typeof readConfig>;

export function readConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = envSchema.parse(env);
  const larkConfigured = Boolean(parsed.LARK_APP_ID && parsed.LARK_APP_SECRET);
  const projectOrder = [...new Set(
    parsed.PROJECT_ORDER.split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isSafeInteger(value) && value > 0),
  )];

  return {
    host: parsed.HOST,
    port: parsed.PORT,
    xingtu: {
      baseUrl: parsed.XINGTU_API_BASE.replace(/\/$/, ""),
      token: parsed.XINGTU_API_TOKEN || undefined,
    },
    projectOrder,
    lark: {
      appId: parsed.LARK_APP_ID || undefined,
      appSecret: parsed.LARK_APP_SECRET || undefined,
      defaultChatId: parsed.LARK_DEFAULT_CHAT_ID || undefined,
      configured: larkConfigured,
      longConnectionEnabled: parsed.LARK_LONG_CONNECTION_ENABLED,
    },
    schedule: {
      enabled: parsed.AUTO_DAILY_REPORT_ENABLED,
      cron: parsed.DAILY_REPORT_CRON,
      timezone: parsed.REPORT_TIMEZONE,
    },
  };
}
