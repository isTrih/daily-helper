import { z } from "zod";
import {
  buildCollapsedReportCard,
  buildLoadingReportCard,
  buildRecallConfirmationCard,
  buildReportCard,
  buildReportUpdateErrorCard,
} from "./card.ts";
import type { CardActionResponse, LongConnectionCardActionEvent } from "./lark-service.ts";
import { ReportService } from "./report-service.ts";
import type { CardJson, CardViewState, ProjectColors, ProjectIcons } from "./types.ts";

const actionValueSchema = z.object({
  action: z.enum([
    "select_period",
    "show_latest",
    "set_ranking",
    "overflow_action",
    "card_tools",
    "open_card_tools",
    "collapse_card",
    "expand_card",
    "request_recall",
    "confirm_recall",
    "cancel_recall",
    "cancel_card_tools",
  ]),
  ranking_mode: z.enum(["today", "yesterday", "period"]).default("today"),
  scope: z.enum(["combined", "period"]).optional(),
  period_ids: z.string().optional(),
  selected_period_id: z.string().optional(),
  enable_forward: z.enum(["true", "false"]).default("false"),
  enable_forward_interaction: z.enum(["true", "false"]).default("false"),
  show_trend: z.enum(["true", "false"]).default("false"),
  controls_mode: z.enum(["full", "tools"]).default("full"),
  expires_at: z.string().optional(),
  return_view: z.enum(["full", "collapsed"]).optional(),
});

type ActionType =
  | "select_period"
  | "show_latest"
  | "set_ranking"
  | "collapse_card"
  | "expand_card"
  | "request_recall"
  | "confirm_recall"
  | "cancel_recall"
  | "toggle_trend"
  | "open_card_tools"
  | "cancel_card_tools";

export function createCardActionHandler(
  reportService: ReportService,
  timezone: string,
  projectColors: ProjectColors = {},
  projectIcons: ProjectIcons = {},
  recallMessage?: (messageId: string) => Promise<void>,
  updateCard?: (messageId: string, card: CardJson) => Promise<void>,
) {
  return async (event: LongConnectionCardActionEvent): Promise<CardActionResponse> => {
    try {
      const action = actionValueSchema.parse(event.action?.value);
      const actionType: ActionType = action.action === "overflow_action"
        ? overflowAction(event.action?.option)
        : action.action === "card_tools"
          ? cardToolAction(event.action?.option)
        : action.action;

      if (actionType === "confirm_recall") {
        if (!recallMessage) throw new Error("当前未启用卡片撤回能力");
        const messageId = event.context?.open_message_id ?? event.open_message_id;
        if (!messageId) throw new Error("回调中缺少卡片消息 ID");
        await recallMessage(messageId);
        return { toast: { type: "success", content: "日报卡片已撤回" } };
      }

      let rankingMode = action.ranking_mode;
      if (action.action === "overflow_action") {
        if (event.action?.option === "rank_today") rankingMode = "today";
        if (event.action?.option === "rank_yesterday") rankingMode = "yesterday";
        if (event.action?.option === "rank_period") rankingMode = "period";
      }
      const originPeriodIds = parsePeriodIds(action.period_ids);
      const enableForward = action.enable_forward === "true";
      const enableForwardInteraction = enableForward && action.enable_forward_interaction === "true";
      let showTrend = action.show_trend === "true";
      if (actionType === "toggle_trend") showTrend = event.action?.option === "show_trend";
      let reportPeriodIds: number[];
      let state: CardViewState;

      if (actionType === "select_period") {
        const selectedPeriodId = Number(event.action?.option);
        if (!Number.isSafeInteger(selectedPeriodId)) throw new Error("期次选择值无效");
        if (originPeriodIds.length === 0 || !originPeriodIds.includes(selectedPeriodId)) {
          throw new Error("该期次不在卡片发送范围内");
        }
        reportPeriodIds = [selectedPeriodId];
        state = {
          scope: "period",
          periodIds: originPeriodIds,
          selectedPeriodId,
          rankingMode,
          enableForward,
          enableForwardInteraction,
          showTrend,
          controlsMode: action.controls_mode,
          ...(action.expires_at ? { interactiveExpiresAt: action.expires_at } : {}),
        };
      } else if (actionType === "show_latest") {
        if (originPeriodIds.length === 0) throw new Error("卡片未包含可选期次");
        reportPeriodIds = originPeriodIds;
        state = {
          scope: "combined",
          periodIds: originPeriodIds,
          rankingMode,
          enableForward,
          enableForwardInteraction,
          showTrend,
          controlsMode: action.controls_mode,
          ...(action.expires_at ? { interactiveExpiresAt: action.expires_at } : {}),
        };
      } else {
        const selectedPeriodId = Number(action.selected_period_id);
        if (action.scope === "period" && Number.isSafeInteger(selectedPeriodId)) {
          if (originPeriodIds.length === 0 || !originPeriodIds.includes(selectedPeriodId)) {
            throw new Error("该期次不在卡片发送范围内");
          }
          reportPeriodIds = [selectedPeriodId];
          state = {
            scope: "period",
            periodIds: originPeriodIds,
            selectedPeriodId,
            rankingMode,
            enableForward,
            enableForwardInteraction,
            showTrend,
            controlsMode: action.controls_mode,
            ...(action.expires_at ? { interactiveExpiresAt: action.expires_at } : {}),
          };
        } else {
          reportPeriodIds = originPeriodIds;
          if (reportPeriodIds.length === 0) throw new Error("卡片未包含可选期次");
          state = {
            scope: "combined",
            periodIds: reportPeriodIds,
            rankingMode,
            enableForward,
            enableForwardInteraction,
            showTrend,
            controlsMode: action.controls_mode,
            ...(action.expires_at ? { interactiveExpiresAt: action.expires_at } : {}),
          };
        }
      }

      const buildResponse = () => buildActionResponse({
        reportService,
        reportPeriodIds,
        state,
        actionType,
        returnView: action.return_view ?? "full",
        timezone,
        projectColors,
        projectIcons,
      });
      const messageId = event.context?.open_message_id ?? event.open_message_id;
      if (updateCard && messageId) {
        void updateCardInBackground(messageId, state, buildResponse, updateCard, timezone);
        return {
          toast: { type: "info", content: "正在更新日报" },
          card: { type: "raw", data: buildLoadingReportCard(state, timezone) },
        };
      }

      return await buildResponse();
    } catch (error) {
      console.error("[lark] 处理卡片回调失败", error);
      return {
        toast: {
          type: "error",
          content: error instanceof Error ? `操作失败：${error.message.slice(0, 80)}` : "操作失败，请稍后重试",
        },
      };
    }
  };
}

async function buildActionResponse(args: {
  reportService: ReportService;
  reportPeriodIds: number[];
  state: CardViewState;
  actionType: ActionType;
  returnView: "full" | "collapsed";
  timezone: string;
  projectColors: ProjectColors;
  projectIcons: ProjectIcons;
}): Promise<CardActionResponse> {
  const {
    reportService,
    reportPeriodIds,
    state,
    actionType,
    returnView,
    timezone,
    projectColors,
    projectIcons,
  } = args;
  const [allPeriods, reports] = await Promise.all([
    reportService.listPeriods(),
    reportService.buildReports(
      reportPeriodIds,
      state.rankingMode,
      state.showTrend === true && reportPeriodIds.length === 1,
    ),
  ]);
  const card = actionType === "collapse_card"
    ? buildCollapsedReportCard({ reports, state, timezone, projectColors, projectIcons })
    : actionType === "request_recall"
      ? buildRecallConfirmationCard({ reports, state, returnView, timezone })
      : (actionType === "toggle_trend" || actionType === "cancel_recall" ||
          actionType === "cancel_card_tools" || actionType === "open_card_tools") &&
          returnView === "collapsed"
        ? buildCollapsedReportCard({ reports, state, timezone, projectColors, projectIcons })
        : buildReportCard({
            reports,
            allPeriods,
            state,
            timezone,
            projectColors,
            projectIcons,
            ...(state.controlsMode ? { controlsMode: state.controlsMode } : {}),
          });
  const toast = actionType === "collapse_card"
    ? { type: "success" as const, content: "卡片已收起" }
    : actionType === "expand_card"
      ? { type: "success" as const, content: "卡片已展开" }
      : actionType === "request_recall"
        ? { type: "warning" as const, content: "请确认是否撤回" }
        : actionType === "toggle_trend"
          ? { type: "success" as const, content: state.showTrend ? "趋势图已显示" : "趋势图已隐藏" }
        : actionType === "cancel_recall" || actionType === "cancel_card_tools" || actionType === "open_card_tools"
          ? { type: "info" as const, content: actionType === "cancel_recall" ? "已取消撤回" : "卡片操作已更新" }
          : { type: "success" as const, content: "日报视图已更新" };
  return { toast, card: { type: "raw", data: card } };
}

async function updateCardInBackground(
  messageId: string,
  state: CardViewState,
  buildResponse: () => Promise<CardActionResponse>,
  updateCard: (messageId: string, card: CardJson) => Promise<void>,
  timezone: string,
): Promise<void> {
  try {
    const response = await buildResponse();
    if (response.card) await updateCard(messageId, response.card.data);
  } catch (error) {
    console.error("[lark] 后台更新卡片失败", error);
    const message = error instanceof Error ? error.message : "数据读取失败，请稍后重试";
    try {
      await updateCard(messageId, buildReportUpdateErrorCard(state, message, timezone));
    } catch (updateError) {
      console.error("[lark] 写入卡片失败状态失败", updateError);
    }
  }
}

function cardToolAction(value: string | undefined): "collapse_card" | "expand_card" | "request_recall" | "toggle_trend" {
  if (value === "collapse_card" || value === "expand_card" || value === "request_recall") return value;
  if (value === "show_trend" || value === "hide_trend") return "toggle_trend";
  throw new Error("卡片管理操作无效");
}

function overflowAction(value: string | undefined): "show_latest" | "set_ranking" {
  if (value === "show_latest") return "show_latest";
  if (value === "rank_today" || value === "rank_yesterday" || value === "rank_period") return "set_ranking";
  throw new Error("折叠按钮操作无效");
}

function parsePeriodIds(value: string | undefined): number[] {
  if (!value) return [];
  return [...new Set(value
    .split(",")
    .map(Number)
    .filter((periodId) => Number.isSafeInteger(periodId) && periodId > 0))];
}
