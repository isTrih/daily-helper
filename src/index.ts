import { createA2CardActionHandler, routeReportCardActions } from "./a2-card-actions.ts";
import { A2_REPORT_GAMES, A2ReportService } from "./a2-report.ts";
import { A2Base, A2Service } from "./a2-service.ts";
import { Cron } from "croner";
import { createA2CommandHandler, createSendDataCommandHandler } from "./bot-command.ts";
import { createCardActionHandler } from "./card-actions.ts";
import { readConfig } from "./config.ts";
import { LarkService } from "./lark-service.ts";
import { ReportOrchestrator } from "./report-orchestrator.ts";
import { ReportService } from "./report-service.ts";
import { ScheduleService, scheduleReportRequest } from "./schedule-service.ts";
import { scheduleRecipients } from "./recipients.ts";
import { startServer } from "./server.ts";
import { XingtuClient } from "./xingtu-client.ts";

const config = readConfig();
const xingtuClient = new XingtuClient(config.xingtu.baseUrl, config.xingtu.token);
const reportService = new ReportService(xingtuClient, config.schedule.timezone, 45_000, config.projectOrder);
const larkService = config.lark.configured
  ? new LarkService(config.lark.appId!, config.lark.appSecret!)
  : undefined;
const a2Service = larkService ? new A2Service({
  ...config.a2, appId: config.lark.appId!, appSecret: config.lark.appSecret!,
}) : undefined;
const a2Reports = larkService ? new A2ReportService(new A2Base(config.lark.appId!, config.lark.appSecret!, config.a2.wikiToken), larkService) : undefined;
const a2Schedules = new ScheduleService(config.a2.schedulesFile, config.schedule.timezone, async schedule => {
  if (!a2Reports || !schedule.request.a2GameCodes) throw new Error("A2 日报服务或游戏选择未配置");
  await a2Reports.send(schedule.request.a2GameCodes, scheduleRecipients(schedule));
});
await a2Schedules.initialize();
const orchestrator = new ReportOrchestrator(
  reportService,
  larkService,
  config.schedule.timezone,
  config.projectColors,
  config.projectIcons,
  a2Service ? () => a2Service.run() : undefined,
);
const scheduleService = new ScheduleService(
  config.schedule.storePath,
  config.schedule.timezone,
  async (schedule) => {
    const result = await orchestrator.send({
      ...scheduleReportRequest(schedule),
      recipients: scheduleRecipients(schedule),
    });
    console.info(`[schedule] 每日推送“${schedule.name}”发送完成，共 ${result.messageCount} 条消息`);
  },
);
await scheduleService.initialize();
const server = startServer({
  config,
  reportService,
  ...(larkService ? { larkService } : {}),
  orchestrator,
  scheduleService,
  ...(a2Service ? { a2Service } : {}),
  ...(a2Reports ? { a2Reports } : {}),
  a2Schedules,
});
const sendDataCommandHandler = createSendDataCommandHandler(async (chatId, projectCodes, { isPrivateChat }) => {
  const latestPeriods = projectCodes ? await reportService.latestPeriods() : [];
  const matchedPeriods = projectCodes
    ? projectCodes.map((projectCode) => latestPeriods.find((period) =>
        [period.projectKey, period.projectDisplayName].some((value) =>
          Array.from(value.toUpperCase().matchAll(/[A-Z0-9]+/g), (match) => match[0]).includes(projectCode),
        ),
      ))
    : [];
  const missingProject = projectCodes?.find((_projectCode, index) => !matchedPeriods[index]);
  if (missingProject) throw new Error(`未找到项目 ${missingProject} 的最新期次`);
  const periodIds = projectCodes
    ? matchedPeriods.map((period) => period!.activityPeriodId)
    : [];
  const result = await orchestrator.send({
    chatIds: [chatId],
    periodIds,
    mode: "combined",
    rankingMode: "today",
    showAllSelected: projectCodes !== undefined,
    isPrivateChat,
  });
  console.info(`[lark] 发送数据指令执行完成，${isPrivateChat ? "私聊" : "群聊"} ${chatId}${projectCodes ? `，项目 ${projectCodes.join("/")}` : ""}，共 ${result.messageCount} 条消息`);
});

const a2CommandHandler = createA2CommandHandler(async chatId => {
  if (!a2Reports) throw new Error("A2 日报服务未配置");
  const result = await a2Reports.send(A2_REPORT_GAMES.map(game => game.code), [chatId], "rok");
  console.info(`[lark] 私聊 A2 口令执行完成，共 ${result.messageCount} 条消息`);
});

let scheduledJob: Cron | undefined;

if (larkService && config.lark.longConnectionEnabled) {
  larkService
    .startCardActionConnection(
      routeReportCardActions(createCardActionHandler(
        reportService,
        config.schedule.timezone,
        config.projectColors,
        config.projectIcons,
        (messageId) => larkService.recallMessage(messageId),
        (messageId, card) => larkService.updateCard(messageId, card),
      ), createA2CardActionHandler(a2Reports, (messageId, card) => larkService.updateCard(messageId, card))),
      async event => {
        if (await a2CommandHandler(event)) return;
        await sendDataCommandHandler(event);
      },
    )
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
  scheduleService.stop();
  a2Schedules.stop();
  larkService?.close();
  server.stop(true);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
