import { z } from "zod";
import type { AppConfig } from "./config.ts";
import type { LarkService } from "./lark-service.ts";
import { ReportOrchestrator } from "./report-orchestrator.ts";
import type { ReportService } from "./report-service.ts";

const reportRequestSchema = z.object({
  periodIds: z.array(z.number().int().positive()).default([]),
  mode: z.enum(["combined", "single"]).default("combined"),
  rankingMode: z.enum(["today", "period"]).default("today"),
  enableForward: z.boolean().default(false),
  enableForwardInteraction: z.boolean().default(false),
});

const sendRequestSchema = reportRequestSchema.extend({
  chatIds: z.array(z.string().trim().min(1)).min(1),
});

export function startServer(args: {
  config: AppConfig;
  reportService: ReportService;
  larkService?: LarkService;
  orchestrator: ReportOrchestrator;
}) {
  const { config, reportService, larkService, orchestrator } = args;

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    async fetch(request) {
      const url = new URL(request.url);
      try {
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
          });
        }

        if (request.method === "POST" && url.pathname === "/api/reports/preview") {
          const input = reportRequestSchema.parse(await readJson(request));
          const cards = await orchestrator.createCards(input);
          return json({ cards });
        }

        if (request.method === "POST" && url.pathname === "/api/reports/send") {
          const input = sendRequestSchema.parse(await readJson(request));
          const result = await orchestrator.send(input);
          return json({ ok: true, ...result });
        }

        if (request.method === "GET" && url.pathname === "/") {
          return staticFile("index.html", "text/html; charset=utf-8");
        }
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
    },
  });

  console.info(`[http] 日报管理页已启动：http://localhost:${server.port}`);
  return server;
}

function staticFile(name: "index.html" | "app.js" | "styles.css", type: string): Response {
  const file = Bun.file(new URL(`../public/${name}`, import.meta.url));
  return new Response(file, {
    headers: {
      "content-type": type,
      "cache-control": name === "index.html" ? "no-cache" : "public, max-age=300",
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
