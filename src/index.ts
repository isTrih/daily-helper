import { Cron } from "croner";
import { createCardActionHandler } from "./card-actions.ts";
import { readConfig } from "./config.ts";
import { LarkService } from "./lark-service.ts";
import { ReportOrchestrator } from "./report-orchestrator.ts";
import { ReportService } from "./report-service.ts";
import { startServer } from "./server.ts";
import { XingtuClient } from "./xingtu-client.ts";

const config = readConfig();
const xingtuClient = new XingtuClient(config.xingtu.baseUrl, config.xingtu.token);
const reportService = new ReportService(xingtuClient, config.schedule.timezone, 45_000, config.projectOrder);
const larkService = config.lark.configured
  ? new LarkService(config.lark.appId!, config.lark.appSecret!)
  : undefined;
const orchestrator = new ReportOrchestrator(
  reportService,
  larkService,
  config.schedule.timezone,
  config.projectColors,
);
const server = startServer({
  config,
  reportService,
  ...(larkService ? { larkService } : {}),
  orchestrator,
});

let scheduledJob: Cron | undefined;

if (larkService && config.lark.longConnectionEnabled) {
  larkService
    .startCardActionConnection(createCardActionHandler(reportService, config.schedule.timezone, config.projectColors))
    .catch((error) => console.error("[lark] 无法建立卡片回调长连接", error));
} else if (!larkService) {
  console.warn("[lark] 未配置应用凭证；网页预览可用，群聊读取、发送和长连接已停用");
}

if (config.schedule.enabled && larkService && config.lark.defaultChatId) {
  scheduledJob = new Cron(
    config.schedule.cron,
    { timezone: config.schedule.timezone, protect: true },
    async () => {
      try {
        const result = await orchestrator.send({
          chatIds: [config.lark.defaultChatId!],
          periodIds: [],
          mode: "combined",
          rankingMode: "today",
        });
        console.info(`[schedule] 自动日报发送完成，共 ${result.messageCount} 条消息`);
      } catch (error) {
        console.error("[schedule] 自动日报发送失败", error);
      }
    },
  );
  console.info(
    `[schedule] 自动日报已启用：${config.schedule.cron} (${config.schedule.timezone})，群聊 ${config.lark.defaultChatId}`,
  );
} else if (config.schedule.enabled) {
  console.warn("[schedule] 自动日报未启动：需要飞书凭证和 LARK_DEFAULT_CHAT_ID");
}

async function shutdown(signal: string) {
  console.info(`[app] 收到 ${signal}，正在停止服务`);
  scheduledJob?.stop();
  larkService?.close();
  server.stop(true);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
