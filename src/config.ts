import { z } from "zod";
import type { CardColor, ProjectColors, ProjectIcons } from "./types.ts";

const cardColors = new Set<CardColor>([
  "blue",
  "wathet",
  "turquoise",
  "green",
  "yellow",
  "orange",
  "red",
  "carmine",
  "violet",
  "purple",
  "indigo",
  "grey",
]);

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
  INTERNAL_API_TOKEN: z.string().trim().min(1, "INTERNAL_API_TOKEN 不能为空"),
  PROJECT_ORDER: z.string().trim().default(""),
  COLOR: z.string().trim().default(""),
  ICON: z.string().trim().default(""),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  AUTO_DAILY_REPORT_ENABLED: booleanFromEnv,
  DAILY_REPORT_CRON: z.string().trim().default("0 9 * * *"),
  REPORT_TIMEZONE: z.string().trim().default("Asia/Shanghai"),
  SCHEDULES_FILE: z.string().trim().min(1).default("data/schedules.json"),
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
  const projectColors = parsed.COLOR.split(",").reduce<ProjectColors>((colors, entry) => {
    const match = /^(\d+)\s*-\s*([a-z]+)$/i.exec(entry.trim());
    if (!match) return colors;
    const projectId = Number(match[1]);
    const color = match[2]!.toLowerCase() as CardColor;
    if (projectId > 0 && Number.isSafeInteger(projectId) && cardColors.has(color)) {
      colors[projectId] = color;
    }
    return colors;
  }, {});
  const projectIcons = parsed.ICON.split(",").reduce<ProjectIcons>((icons, entry) => {
    const match = /^(\d+)\s*-\s*([^\s,]+)$/.exec(entry.trim());
    if (!match) return icons;
    const projectId = Number(match[1]);
    if (projectId > 0 && Number.isSafeInteger(projectId)) {
      icons[projectId] = match[2]!;
    }
    return icons;
  }, {});

  return {
    host: parsed.HOST,
    port: parsed.PORT,
    xingtu: {
      baseUrl: parsed.XINGTU_API_BASE.replace(/\/$/, ""),
      token: parsed.INTERNAL_API_TOKEN,
    },
    projectOrder,
    projectColors,
    projectIcons,
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
      storePath: parsed.SCHEDULES_FILE,
    },
  };
}
