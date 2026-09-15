import { buildReportCard } from "./card.ts";
import { LarkService } from "./lark-service.ts";
import { ReportService } from "./report-service.ts";
import type { CardJson, ProjectColors, ProjectIcons, RankingMode, ReportMode } from "./types.ts";

export interface ReportRequest {
  periodIds: number[];
  mode: ReportMode;
  rankingMode: RankingMode;
  enableForward?: boolean;
  enableForwardInteraction?: boolean;
  showTrend?: boolean;
}

export interface SendReportRequest extends ReportRequest {
  chatIds: string[];
}

export class ReportOrchestrator {
  constructor(
    private readonly reports: ReportService,
    private readonly lark: LarkService | undefined,
    private readonly timezone: string,
    private readonly projectColors: ProjectColors = {},
    private readonly projectIcons: ProjectIcons = {},
  ) {}

  async createCards(request: ReportRequest): Promise<CardJson[]> {
    const allPeriods = await this.reports.listPeriods();
    const requestedIds = request.periodIds.length > 0
      ? [...new Set(request.periodIds)]
      : (await this.reports.latestPeriods()).map((period) => period.activityPeriodId);
    if (requestedIds.length === 0) throw new Error("没有可发送的项目期次");
    const enableForward = request.enableForward ?? false;
    const enableForwardInteraction = enableForward && (request.enableForwardInteraction ?? false);
    const showTrend = request.showTrend ?? false;

    if (request.mode === "combined") {
      const initialPeriodId = requestedIds[0]!;
      const periodReports = await this.reports.buildReports([initialPeriodId], request.rankingMode, showTrend);
      return [
        buildReportCard({
          reports: periodReports,
          allPeriods,
          state: {
            scope: "period",
            periodIds: requestedIds,
            selectedPeriodId: initialPeriodId,
            rankingMode: request.rankingMode,
            enableForward,
            enableForwardInteraction,
            showTrend,
          },
          timezone: this.timezone,
          projectColors: this.projectColors,
          projectIcons: this.projectIcons,
        }),
      ];
    }

    const periodReports = await this.reports.buildReports(requestedIds, request.rankingMode, showTrend);
    return periodReports.map((report) =>
      buildReportCard({
        reports: [report],
        allPeriods,
        interactive: false,
        projectColors: this.projectColors,
        projectIcons: this.projectIcons,
        state: {
          scope: "period",
          periodIds: [report.period.activityPeriodId],
          selectedPeriodId: report.period.activityPeriodId,
          rankingMode: request.rankingMode,
          enableForward,
          enableForwardInteraction,
          showTrend,
        },
        timezone: this.timezone,
      }),
    );
  }

  async send(request: SendReportRequest) {
    if (!this.lark) throw new Error("未配置 LARK_APP_ID / LARK_APP_SECRET，无法发送飞书消息");
    const chatIds = [...new Set(request.chatIds.map((id) => id.trim()).filter(Boolean))];
    if (chatIds.length === 0) throw new Error("请至少选择一个发送群聊");
    const cards = await this.createCards(request);
    const results: Array<{ chatId: string; messageId: string; cardIndex: number }> = [];

    for (const chatId of chatIds) {
      for (const [cardIndex, card] of cards.entries()) {
        const messageId = await this.lark.sendCard(chatId, card);
        results.push({ chatId, messageId, cardIndex });
      }
    }
    return { cardCount: cards.length, messageCount: results.length, messages: results };
  }
}
