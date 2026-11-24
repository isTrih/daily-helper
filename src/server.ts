import { A2CollectionError, type A2Service } from "./a2-service.ts";
import { historyInput } from "./a2-history.ts";
import { a2ReportRequest, A2_REPORT_GAMES, type A2ReportService } from "./a2-report.ts";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "./config.ts";
import type { LarkService } from "./lark-service.ts";
import { ReportOrchestrator } from "./report-orchestrator.ts";
import type { ReportService } from "./report-service.ts";
import { deliveryScheduleInputSchema, type ScheduleService } from "./schedule-service.ts";
import { recipientsSchema } from "./recipients.ts";
import { MAX_TOPIC_KEYWORD_LENGTH, MAX_TOPIC_KEYWORDS, normalizeTopicKeywords } from "./topics.ts";

const reportRequestSchema = z.object({
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

const sendRequestSchema = reportRequestSchema.extend({
  chatIds: z.array(z.string().trim().min(1)).min(1).max(500).optional(),
  recipients: recipientsSchema.optional(),
}).refine(value => !!value.recipients?.length || !!value.chatIds?.length, { message: "请选择群聊或用户" });

type A2RefreshJob = { id: string; status: "running" | "success" | "error"; error?: string };

export function startServer(args: {
  a2Service?: A2Service;
  a2Reports?: A2ReportService;
  a2Schedules?: ScheduleService;
  config: AppConfig;
  reportService: ReportService;
  larkService?: LarkService;
  orchestrator: ReportOrchestrator;
  scheduleService?: ScheduleService;
}) {
  const { config, reportService, larkService, orchestrator, scheduleService } = args;
  let refreshJob: A2RefreshJob | undefined;

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    maxRequestBodySize: 1024 * 1024,
    fetch: logRequests(async (request, server) => {
      const url = new URL(request.url);
      try {
        if (request.method === "GET" && url.pathname === "/api/recipients/users") {
          if (!larkService) return json({ error: "尚未配置飞书应用" }, 503);
          server.timeout(request, 0);
          try { return json(await larkService.listUsers(url.searchParams.get("refresh") === "1")); }
          catch { return json({ error: "无法读取机器人所在群聊的成员：请检查机器人入群状态，以及群聊列表和群成员读取权限（im:chat:read、im:chat.members:read）。" }, 503); }
        }
        if (url.pathname === "/api/a2/auth") {
          if (request.method !== "POST") return json({ error: "仅支持 POST" }, 405);
          const origin = request.headers.get("origin");
          if (origin && origin !== url.origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) && !/^moz-extension:\/\/[0-9a-f-]+$/i.test(origin)) return json({ error: "上传来源无效" }, 403);
          // Older extensions omit this optional protocol marker. The full body is
          // still validated by authSchema; absence of a non-secret header is not an error.
          const uploadProtocol = request.headers.get("x-a2-upload");
          if (uploadProtocol !== null && uploadProtocol !== "yuntu-session-v1") return json({ error: "不支持的上传协议版本，请更新插件" }, 415);
          if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return json({ error: "上传需要 Content-Type: application/json" }, 415);
          if (!args.a2Service) return json({ error: "A2 未启用" }, 503);
          const body = await request.text();
          if (body.length > 512000) return json({ error: "登录态过大" }, 413);
          let input: unknown;
          try { input = JSON.parse(body); } catch { return json({ error: "上传 JSON 格式无效" }, 400); }
          return json(await args.a2Service.upload(input));
        }
        if (url.pathname.startsWith("/api/a2/reports/")) {
          if (request.method === "GET" && url.pathname === "/api/a2/reports/bootstrap") {
            let chats: Awaited<ReturnType<LarkService["listChats"]>> = [];
            let chatsError = "";
            try { chats = larkService ? await larkService.listChats() : []; } catch { chatsError = "无法读取群聊，请刷新或手动输入群聊 ID"; }
            return json({ games: A2_REPORT_GAMES, chats, chatsError, schedules: args.a2Schedules?.list() ?? [], timezone: config.schedule.timezone, defaultChatId: config.lark.defaultChatId ?? "", cloudRefreshEnabled: !!(config.a2.token && args.a2Service) });
          }
          if (["/api/a2/reports/preview", "/api/a2/reports/send"].includes(url.pathname) && request.method === "POST") {
            if (!args.a2Reports) return json({ error: "A2 日报未配置飞书应用" }, 503);
            server.timeout(request, 0);
            if (url.pathname.endsWith("/preview")) {
              const input = a2ReportRequest.extend({ refresh: z.boolean().optional() }).parse(await readJson(request));
              return json(await args.a2Reports.preview(input.gameCodes, input.refresh));
            }
            const input = a2ReportRequest.extend({ chatIds: z.array(z.string().trim().min(1).max(128)).min(1).max(500).optional(), recipients: recipientsSchema.optional() }).refine(value => !!value.recipients?.length || !!value.chatIds?.length).parse(await readJson(request));
            return json(await args.a2Reports.send(input.gameCodes, input.recipients ?? input.chatIds ?? []));
          }
          if (!args.a2Schedules) return json({ error: "A2 计划服务未启用" }, 503);
          const match = /^\/api\/a2\/reports\/schedules\/([0-9a-f-]+)$/i.exec(url.pathname);
          if (url.pathname === "/api/a2/reports/schedules" && request.method === "GET") return json({ schedules: args.a2Schedules.list() });
          if ((url.pathname === "/api/a2/reports/schedules" && request.method === "POST") || (match && request.method === "PUT")) {
            const input = a2ReportRequest.extend({ name: z.string().trim().min(1).max(60), chatId: z.string().trim().min(1).max(128).optional(), recipients: recipientsSchema.optional(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), enabled: z.boolean() }).parse(await readJson(request));
            const value = deliveryScheduleInputSchema.parse({ ...input, request: { a2GameCodes: input.gameCodes } });
            const schedule = match ? await args.a2Schedules.update(match[1]!, value) : await args.a2Schedules.create(value);
            return schedule ? json({ schedule }) : json({ error: "找不到该 A2 计划" }, 404);
          }
          if (match && request.method === "PATCH") {
            const input = z.strictObject({ enabled: z.boolean() }).parse(await readJson(request));
            const schedule = await args.a2Schedules.setEnabled(match[1]!, input.enabled);
            return schedule ? json({ schedule }) : json({ error: "找不到该 A2 计划" }, 404);
          }
          if (match && request.method === "DELETE") return json({ ok: await args.a2Schedules.delete(match[1]!) });
          return json({ error: "Not found" }, 404);
        }
        if (url.pathname.startsWith("/api/a2/")) {
          const expected = Buffer.from(`Bearer ${config.a2.token}`);
          const actual = Buffer.from(request.headers.get("authorization") ?? "");
          if (!config.a2.token || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json({ error: "Unauthorized" }, 401);
          if (!args.a2Service) return json({ error: "A2 未启用" }, 503);
          if (request.method === "GET" && url.pathname === "/api/a2/status") return json(await args.a2Service.status());
          if (request.method === "GET" && url.pathname === "/api/a2/collect") {
            if (!refreshJob || refreshJob.id !== url.searchParams.get("job")) return json({ error: "采集任务已不存在，请重新拉取" }, 404);
            return json(refreshJob);
          }
          if (request.method === "POST" && url.pathname === "/api/a2/collect") {
            if (url.searchParams.get("background") === "1") {
              if (refreshJob?.status !== "running") {
                const job: A2RefreshJob = { id: crypto.randomUUID(), status: "running" };
                refreshJob = job;
                void args.a2Service.run(undefined, { refreshLatest: true, runId: job.id }).then(
                  () => { job.status = "success"; },
                  error => {
                    job.status = "error";
                    job.error = error instanceof A2CollectionError ? error.message : "云图采集未完成，请查看服务端采集日志";
                  },
                );
              }
              return json(refreshJob, 202);
            }
            // A full browser collection exceeds Bun's default 10-second idle limit.
            server.timeout(request, 0);
            await args.a2Service.run();
            return json(await args.a2Service.status());
          }
          if (request.method === "POST" && url.pathname === "/api/a2/backfill") {
            const input = historyInput.parse(await readJson(request));
            server.timeout(request, 0);
            const result = await args.a2Service.backfill(input.start, input.end);
            return json(result, result.status === "success" ? 200 : 502);
          }
          return json({ error: "Not found" }, 404);
        }
        if (request.method === "GET" && url.pathname === "/healthz") {
          return json({ ok: true, larkConfigured: config.lark.configured });
        }

        if (request.method === "GET" && url.pathname === "/api/bootstrap") {
          const periods = await reportService.listPeriods();
          let chats: Awaited<ReturnType<LarkService["listChats"]>> = [];
          let chatsError: string | undefined;
          if (larkService) {
            try {
              chats = await larkService.listChats();
            } catch (error) {
              chatsError = errorMessage(error);
            }
          } else {
            chatsError = "尚未配置飞书应用凭证";
          }
          return json({
            periods,
            chats,
            ...(chatsError ? { chatsError } : {}),
            defaultChatId: config.lark.defaultChatId ?? "",
            larkConfigured: config.lark.configured,
            schedules: scheduleService?.list() ?? [],
            timezone: config.schedule.timezone,
          });
        }

        if (request.method === "GET" && url.pathname === "/api/schedules") {
          return json({ schedules: scheduleService?.list() ?? [] });
        }

        if (request.method === "POST" && url.pathname === "/api/schedules") {
          if (!scheduleService) return json({ error: "每日推送计划服务未启用" }, 503);
          const input = deliveryScheduleInputSchema.parse(await readJson(request));
          return json({ schedule: await scheduleService.create(input) }, 201);
        }

        const scheduleMatch = /^\/api\/schedules\/([0-9a-f-]+)$/i.exec(url.pathname);
        if (scheduleMatch && request.method === "PUT") {
          if (!scheduleService) return json({ error: "每日推送计划服务未启用" }, 503);
          const input = deliveryScheduleInputSchema.parse(await readJson(request));
          const schedule = await scheduleService.update(scheduleMatch[1]!, input);
          return schedule ? json({ schedule }) : json({ error: "找不到该推送计划" }, 404);
        }
        if (scheduleMatch && request.method === "PATCH") {
          if (!scheduleService) return json({ error: "每日推送计划服务未启用" }, 503);
          const input = z.object({ enabled: z.boolean() }).parse(await readJson(request));
          const schedule = await scheduleService.setEnabled(scheduleMatch[1]!, input.enabled);
          return schedule ? json({ schedule }) : json({ error: "找不到该推送计划" }, 404);
        }
        if (scheduleMatch && request.method === "DELETE") {
          if (!scheduleService) return json({ error: "每日推送计划服务未启用" }, 503);
          const deleted = await scheduleService.delete(scheduleMatch[1]!);
          return deleted ? json({ ok: true }) : json({ error: "找不到该推送计划" }, 404);
        }

        if (request.method === "POST" && url.pathname === "/api/reports/preview") {
          const { refresh, ...input } = reportRequestSchema.extend({ refresh: z.boolean().optional() }).parse(await readJson(request));
          if (refresh) server.timeout(request, 0);
          const cards = await orchestrator.createCards(input, refresh);
          return json({ cards });
        }

        if (request.method === "POST" && url.pathname === "/api/reports/send") {
          server.timeout(request, 0);
          const input = sendRequestSchema.parse(await readJson(request));
          const result = await orchestrator.send(input);
          return json({ ok: true, ...result });
        }

        if (request.method === "GET" && url.pathname === "/") {
          return staticFile("index.html", "text/html; charset=utf-8");
        }
        if (request.method === "GET" && url.pathname === "/a2") return staticFile("a2.html", "text/html; charset=utf-8");
        if (request.method === "GET" && url.pathname === "/recipients.js") return staticFile("recipients.js", "text/javascript; charset=utf-8");
        if (request.method === "GET" && url.pathname === "/a2.js") return staticFile("a2.js", "text/javascript; charset=utf-8");
        if (request.method === "GET" && url.pathname === "/app.js") {
          return staticFile("app.js", "text/javascript; charset=utf-8");
        }
        if (request.method === "GET" && url.pathname === "/styles.css") {
          return staticFile("styles.css", "text/css; charset=utf-8");
        }
        return json({ error: "Not found" }, 404);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return json({ error: "请求参数无效", details: z.flattenError(error) }, 400);
        }
        console.error("[http] 请求处理失败", error);
        return json({ error: errorMessage(error) }, 500);
      }
    }),
  });

  console.info(`[http] 日报管理页已启动：http://localhost:${server.port}`);
  return server;
}

function logRequests(handle: (request: Request, server: Bun.Server<undefined>) => Promise<Response>) {
  return async (request: Request, server: Bun.Server<undefined>) => {
    const started = performance.now();
    const response = await handle(request, server);
    const path = response.status === 404 ? "(未匹配路由)" : new URL(request.url).pathname;
    console.info(`[http] ${request.method} ${path} ${response.status} ${Math.round(performance.now() - started)}ms`);
    return response;
  };
}

function staticFile(name: "index.html" | "a2.html" | "a2.js" | "app.js" | "recipients.js" | "styles.css", type: string): Response {
  const file = Bun.file(new URL(`../public/${name}`, import.meta.url));
  return new Response(file, {
    headers: {
      "content-type": type,
      "cache-control": name.endsWith(".html") ? "no-cache" : "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("Content-Type 必须为 application/json");
  return request.json();
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
