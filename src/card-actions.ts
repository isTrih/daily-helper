import { z } from "zod";
import { buildReportCard } from "./card.ts";
import type { CardActionResponse, LongConnectionCardActionEvent } from "./lark-service.ts";
import { ReportService } from "./report-service.ts";
import type { CardViewState } from "./types.ts";

const actionValueSchema = z.object({
  action: z.enum(["select_period", "show_latest", "set_ranking", "overflow_action"]),
  ranking_mode: z.enum(["today", "period"]).default("today"),
  scope: z.enum(["combined", "period"]).optional(),
  period_ids: z.string().optional(),
  selected_period_id: z.string().optional(),
});

export function createCardActionHandler(reportService: ReportService, timezone: string) {
  return async (event: LongConnectionCardActionEvent): Promise<CardActionResponse> => {
    try {
      const action = actionValueSchema.parse(event.action?.value);
      const actionType: "select_period" | "show_latest" | "set_ranking" = action.action === "overflow_action"
        ? overflowAction(event.action?.option)
        : action.action;
      let rankingMode = action.ranking_mode;
      if (action.action === "overflow_action") {
        if (event.action?.option === "rank_today") rankingMode = "today";
        if (event.action?.option === "rank_period") rankingMode = "period";
      }
      const allPeriods = await reportService.listPeriods();
      const originPeriodIds = parsePeriodIds(action.period_ids);
      let reportPeriodIds: number[];
      let state: CardViewState;

      if (actionType === "select_period") {
        const selectedPeriodId = Number(event.action?.option);
        if (!Number.isSafeInteger(selectedPeriodId)) throw new Error("期次选择值无效");
        reportPeriodIds = [selectedPeriodId];
        state = {
          scope: "period",
          periodIds: originPeriodIds.length > 0 ? originPeriodIds : [selectedPeriodId],
          selectedPeriodId,
          rankingMode,
        };
      } else if (actionType === "show_latest") {
        const latest = await reportService.latestPeriods();
        reportPeriodIds = latest.map((period) => period.activityPeriodId);
        state = {
          scope: "combined",
          periodIds: reportPeriodIds,
          rankingMode,
        };
      } else {
        const selectedPeriodId = Number(action.selected_period_id);
        if (action.scope === "period" && Number.isSafeInteger(selectedPeriodId)) {
          reportPeriodIds = [selectedPeriodId];
          state = {
            scope: "period",
            periodIds: originPeriodIds.length > 0 ? originPeriodIds : reportPeriodIds,
            selectedPeriodId,
            rankingMode,
          };
        } else {
          reportPeriodIds = originPeriodIds;
          if (reportPeriodIds.length === 0) {
            reportPeriodIds = (await reportService.latestPeriods()).map((period) => period.activityPeriodId);
          }
          state = { scope: "combined", periodIds: reportPeriodIds, rankingMode };
        }
      }

      const reports = await reportService.buildReports(reportPeriodIds, state.rankingMode);
      const card = buildReportCard({ reports, allPeriods, state, timezone });
      return {
        toast: { type: "success", content: "日报视图已更新" },
        card: { type: "raw", data: card },
      };
    } catch (error) {
      console.error("[lark] 处理卡片回调失败", error);
      return {
        toast: {
          type: "error",
          content: error instanceof Error ? `更新失败：${error.message.slice(0, 80)}` : "更新失败，请稍后重试",
        },
      };
    }
  };
}

function overflowAction(value: string | undefined): "show_latest" | "set_ranking" {
  if (value === "show_latest") return "show_latest";
  if (value === "rank_today" || value === "rank_period") return "set_ranking";
  throw new Error("折叠按钮操作无效");
}

function parsePeriodIds(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map(Number)
    .filter(Number.isSafeInteger);
}
