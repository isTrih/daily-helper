import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Cron } from "croner";
import { z } from "zod";
import { recipientsSchema } from "./recipients.ts";
import type { ReportRequest } from "./report-orchestrator.ts";
import { MAX_TOPIC_KEYWORD_LENGTH, MAX_TOPIC_KEYWORDS, normalizeTopicKeywords } from "./topics.ts";

const dailyTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "发送时间必须为 HH:mm");

const scheduledReportRequestSchema = z.object({
  a2GameCodes: z.array(z.enum(["w", "rok", "samo", "pgame"])).min(1).max(4).optional(),
  periodIds: z.array(z.number().int().positive()).default([]),
  projectIds: z.array(z.number().int().positive()).default([]),
  mode: z.enum(["combined", "single"]).default("combined"),
  rankingMode: z.enum(["today", "yesterday", "period"]).default("today"),
  enableForward: z.boolean().default(false),
  enableForwardInteraction: z.boolean().default(false),
  showTrend: z.boolean().default(false),
  topicKeywords: z.array(z.string().trim().min(1).max(MAX_TOPIC_KEYWORD_LENGTH + 1))
    .max(MAX_TOPIC_KEYWORDS)
    .default([])
    .transform(normalizeTopicKeywords),
});

export const deliveryScheduleInputSchema = z.object({
  name: z.string().trim().min(1, "计划名称不能为空").max(60),
  chatId: z.string().trim().min(1).max(128).optional(),
  recipients: recipientsSchema.optional(),
  time: dailyTimeSchema,
  enabled: z.boolean().default(true),
  request: scheduledReportRequestSchema,
}).refine(value => !!value.recipients?.length || !!value.chatId, { message: "请选择至少一个群聊或用户", path: ["recipients"] });

const deliveryScheduleSchema = deliveryScheduleInputSchema.safeExtend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastRunAt: z.string().datetime().optional(),
  lastStatus: z.enum(["running", "success", "error"]).optional(),
  lastError: z.string().max(300).optional(),
});

const scheduleStoreSchema = z.object({
  version: z.literal(1),
  schedules: z.array(deliveryScheduleSchema),
});

export type DeliveryScheduleInput = z.input<typeof deliveryScheduleInputSchema>;
export type DeliverySchedule = z.infer<typeof deliveryScheduleSchema>;
export type DeliveryScheduleView = DeliverySchedule & { nextRunAt?: string };

export class ScheduleService {
  private readonly filePath: string;
  private readonly schedules = new Map<string, DeliverySchedule>();
  private readonly jobs = new Map<string, Cron>();
  private writeChain = Promise.resolve();

  constructor(
    filePath: string,
    private readonly timezone: string,
    private readonly runSchedule: (schedule: DeliverySchedule) => Promise<void>,
  ) {
    this.filePath = resolve(filePath);
  }

  async initialize(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const store = scheduleStoreSchema.parse(JSON.parse(raw));
      for (const schedule of store.schedules) this.schedules.set(schedule.id, schedule);
    } catch (error) {
      if (!isMissingFileError(error)) throw new Error(`读取每日推送计划失败：${errorMessage(error)}`);
    }
    for (const schedule of this.schedules.values()) this.syncJob(schedule);
  }

  list(): DeliveryScheduleView[] {
    return [...this.schedules.values()]
      .sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name, "zh-CN"))
      .map((schedule) => {
        const nextRun = this.jobs.get(schedule.id)?.nextRun();
        return { ...structuredClone(schedule), ...(nextRun ? { nextRunAt: nextRun.toISOString() } : {}) };
      });
  }

  async create(input: DeliveryScheduleInput): Promise<DeliveryScheduleView> {
    const value = deliveryScheduleInputSchema.parse(input);
    const now = new Date().toISOString();
    const schedule: DeliverySchedule = {
      ...structuredClone(value),
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    if (schedule.recipients) delete schedule.chatId;
    this.schedules.set(schedule.id, schedule);
    this.syncJob(schedule);
    await this.persist();
    return this.get(schedule.id)!;
  }

  async update(id: string, input: DeliveryScheduleInput): Promise<DeliveryScheduleView | undefined> {
    const current = this.schedules.get(id);
    if (!current) return undefined;
    const value = deliveryScheduleInputSchema.parse(input);
    const schedule: DeliverySchedule = {
      ...current,
      ...structuredClone(value),
      updatedAt: new Date().toISOString(),
    };
    if (value.recipients) delete schedule.chatId;
    else delete schedule.recipients;
    this.schedules.set(id, schedule);
    this.syncJob(schedule);
    await this.persist();
    return this.get(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<DeliveryScheduleView | undefined> {
    const current = this.schedules.get(id);
    if (!current) return undefined;
    const schedule = { ...current, enabled, updatedAt: new Date().toISOString() };
    this.schedules.set(id, schedule);
    this.syncJob(schedule);
    await this.persist();
    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    if (!this.schedules.delete(id)) return false;
    this.jobs.get(id)?.stop();
    this.jobs.delete(id);
    await this.persist();
    return true;
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  private get(id: string): DeliveryScheduleView | undefined {
    return this.list().find((schedule) => schedule.id === id);
  }

  private syncJob(schedule: DeliverySchedule): void {
    this.jobs.get(schedule.id)?.stop();
    this.jobs.delete(schedule.id);
    if (!schedule.enabled) return;
    const [hour, minute] = schedule.time.split(":").map(Number);
    const job = new Cron(
      `${minute} ${hour} * * *`,
      { timezone: this.timezone, protect: true },
      () => this.execute(schedule.id),
    );
    this.jobs.set(schedule.id, job);
  }

  private async execute(id: string): Promise<void> {
    const current = this.schedules.get(id);
    if (!current?.enabled) return;
    const started: DeliverySchedule = {
      ...current,
      lastRunAt: new Date().toISOString(),
      lastStatus: "running",
      updatedAt: current.updatedAt,
    };
    delete started.lastError;
    this.schedules.set(id, started);
    await this.persist();
    try {
      await this.runSchedule(structuredClone(started));
      const latest = this.schedules.get(id);
      if (!latest) return;
      this.schedules.set(id, { ...latest, lastStatus: "success" });
    } catch (error) {
      const latest = this.schedules.get(id);
      if (!latest) return;
      this.schedules.set(id, {
        ...latest,
        lastStatus: "error",
        lastError: errorMessage(error).slice(0, 300),
      });
      console.error(`[schedule] 每日推送“${current.name}”执行失败`, error);
    }
    await this.persist();
  }

  private persist(): Promise<void> {
    const store = JSON.stringify({ version: 1, schedules: [...this.schedules.values()] }, null, 2) + "\n";
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, store, "utf8");
    });
    return this.writeChain;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

export function scheduleReportRequest(schedule: DeliverySchedule): ReportRequest {
  return {
    ...schedule.request,
    projectIds: schedule.request.projectIds,
  };
}
