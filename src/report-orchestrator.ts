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
  showAllSelected?: boolean;
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
    const periodsById = new Map(allPeriods.map((period) => [period.activityPeriodId, period]));
    const requestedPeriods = requestedIds.map((periodId) => {
      const period = periodsById.get(periodId);
      if (!period) throw new Error(`期次 ${periodId} 不在当前可发送列表中`);
      return period;
    });
    const periodCountByProject = new Map<number, number>();
    for (const period of requestedPeriods) {
      const count = (periodCountByProject.get(period.projectId) ?? 0) + 1;
      if (count > 2) throw new Error(`${period.projectDisplayName} 最多可同时选择两个期次`);
      periodCountByProject.set(period.projectId, count);
    }
    const enableForward = request.enableForward ?? false;
    const enableForwardInteraction = enableForward && (request.enableForwardInteraction ?? false);
    const showTrend = request.showTrend ?? false;
    const interactiveExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString();

    if (request.mode === "combined") {
      const initialPeriodId = requestedIds[0]!;
      const combineSelectedPeriods = requestedIds.length > 1 &&
        (periodCountByProject.size === 1 || request.showAllSelected === true);
      const visiblePeriodIds = combineSelectedPeriods ? requestedIds : [initialPeriodId];
      const periodReports = await this.reports.buildReports(
        visiblePeriodIds,
        request.rankingMode,
        showTrend && visiblePeriodIds.length === 1,
      );
      return [
        buildReportCard({
          reports: periodReports,
          allPeriods,
          state: {
            scope: combineSelectedPeriods ? "combined" : "period",
            periodIds: requestedIds,
            ...(combineSelectedPeriods ? {} : { selectedPeriodId: initialPeriodId }),
            rankingMode: request.rankingMode,
            enableForward,
            enableForwardInteraction,
            showTrend,
            interactiveExpiresAt,
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
        controlsMode: "tools",
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
          controlsMode: "tools",
          interactiveExpiresAt,
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
