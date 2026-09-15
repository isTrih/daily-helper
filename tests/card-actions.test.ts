import { describe, expect, test } from "bun:test";
import { createCardActionHandler } from "../src/card-actions.ts";
import type { PeriodReport, ProjectPeriod } from "../src/types.ts";

const periods: ProjectPeriod[] = [
  {
    activityPeriodId: 53,
    projectId: 3,
    projectKey: "[PGAME]塔塔冒险队",
    projectDisplayName: "[PGAMES]生态",
    period: "塔塔冒险队26年9月第一期",
    isLatest: true,
  },
  {
    activityPeriodId: 10,
    projectId: 1,
    projectKey: "[ROK]万国觉醒创作营",
    projectDisplayName: "[ROK]生态",
    period: "万国26年9月第十六期",
    isLatest: true,
  },
];

function makeReport(period: ProjectPeriod): PeriodReport {
  return {
    period,
    range: {
      from: "2026-09-01",
      to: "2026-09-14",
      today: "2026-09-14",
      yesterday: "2026-09-13",
      dayBefore: "2026-09-12",
    },
    video: {
      cumulative: { playCount: 100, likeCount: 10, commentCount: 2, contentCount: 3, authorCount: 2 },
      today: { playCount: 20, likeCount: 2, commentCount: 1, contentCount: 1, authorCount: 1 },
      yesterday: { playCount: 15, likeCount: 1, commentCount: 1, contentCount: 1, authorCount: 1 },
      dayBefore: { playCount: 10, likeCount: 1, commentCount: 0, contentCount: 1, authorCount: 1 },
      topGrowth: [],
      trend: [
        { date: "2026-09-13", playCount: 15, contentCount: 1, authorCount: 1 },
        { date: "2026-09-14", playCount: 20, contentCount: 1, authorCount: 1 },
      ],
    },
    live: {
      cumulative: { liveExposurePv: 200, avgAcu: 3, liveSessionCount: 4, anchorCount: 2 },
      today: { liveExposurePv: 0, avgAcu: null, liveSessionCount: 1, anchorCount: 1 },
      yesterday: { liveExposurePv: 50, avgAcu: 2, liveSessionCount: 1, anchorCount: 1 },
      dayBefore: { liveExposurePv: 40, avgAcu: 2, liveSessionCount: 1, anchorCount: 1 },
    },
  };
}

const fakeReportService = {
  listPeriods: async () => periods,
  latestPeriods: async () => periods,
  buildReports: async (ids: number[]) =>
    ids.map((id) => makeReport(periods.find((period) => period.activityPeriodId === id)!)),
};

describe("折叠按钮组回调", () => {
  test("所有项目选项返回紧凑多项目卡片", async () => {
    const handler = createCardActionHandler(fakeReportService as never, "Asia/Shanghai");
    const response = await handler({
      action: {
        tag: "overflow",
        option: "show_latest",
        value: {
          action: "overflow_action",
          ranking_mode: "today",
          scope: "period",
          period_ids: "53,10",
          selected_period_id: "53",
        },
      },
    });
    expect(response.toast?.type).toBe("success");
    expect((response.card?.data.header as { title: { content: string } }).title.content).toBe("项目每日速览");
    expect(JSON.stringify(response.card?.data)).toContain("[ROK]生态");
  });

  test("所有项目和项目切换都受发送期次白名单约束", async () => {
    const augustPeriod: ProjectPeriod = {
      ...periods[1]!,
      activityPeriodId: 9,
      period: "万国26年8月第十五期",
      isLatest: false,
    };
    const availablePeriods = [...periods, augustPeriod];
    let builtIds: number[] = [];
    const reportService = {
      listPeriods: async () => availablePeriods,
      latestPeriods: async () => {
        throw new Error("不应读取全局最新期次");
      },
      buildReports: async (ids: number[]) => {
        builtIds = ids;
        return ids.map((id) => makeReport(availablePeriods.find((period) => period.activityPeriodId === id)!));
      },
    };
    const handler = createCardActionHandler(reportService as never, "Asia/Shanghai");
    const allProjects = await handler({
      action: {
        tag: "overflow",
        option: "show_latest",
        value: {
          action: "overflow_action",
          ranking_mode: "today",
          scope: "period",
          period_ids: "53,9",
          selected_period_id: "9",
        },
      },
    });
    expect(builtIds).toEqual([53, 9]);
    expect(JSON.stringify(allProjects.card?.data)).toContain("万国26年8月第十五期");
    expect(JSON.stringify(allProjects.card?.data)).not.toContain("万国26年9月第十六期");

    const outsideSelection = await handler({
      action: {
        tag: "select_static",
        option: "10",
        value: {
          action: "select_period",
          ranking_mode: "today",
          period_ids: "53,9",
        },
      },
    });
    expect(outsideSelection.toast).toEqual({ type: "error", content: "操作失败：该期次不在卡片发送范围内" });
    expect(outsideSelection.card).toBeUndefined();
  });

  test("本期 TOP 选项覆盖当前排行模式", async () => {
    const handler = createCardActionHandler(fakeReportService as never, "Asia/Shanghai");
    const response = await handler({
      action: {
        tag: "overflow",
        option: "rank_period",
        value: {
          action: "overflow_action",
          ranking_mode: "today",
          scope: "period",
          period_ids: "53,10",
          selected_period_id: "53",
        },
      },
    });
    expect(response.toast?.type).toBe("success");
    expect(JSON.stringify(response.card?.data)).toContain("本期 TOP · 视频播放");
  });

  test("昨日 TOP 选项覆盖当前排行模式", async () => {
    let rankingMode = "";
    const reportService = {
      ...fakeReportService,
      buildReports: async (ids: number[], mode: string) => {
        rankingMode = mode;
        return ids.map((id) => makeReport(periods.find((period) => period.activityPeriodId === id)!));
      },
    };
    const handler = createCardActionHandler(reportService as never, "Asia/Shanghai");
    const response = await handler({
      action: {
        tag: "overflow",
        option: "rank_yesterday",
        value: {
          action: "overflow_action",
          ranking_mode: "today",
          scope: "period",
          period_ids: "53,10",
          selected_period_id: "53",
        },
      },
    });
    expect(rankingMode).toBe("yesterday");
    expect(JSON.stringify(response.card?.data)).toContain("昨日 TOP · 视频播放");
  });

  test("折叠按钮组可显示和隐藏单期趋势图", async () => {
    let includeTrend = false;
    const reportService = {
      ...fakeReportService,
      buildReports: async (ids: number[], _mode: string, requestedTrend: boolean) => {
        includeTrend = requestedTrend;
        return ids.map((id) => makeReport(periods.find((period) => period.activityPeriodId === id)!));
      },
    };
    const handler = createCardActionHandler(reportService as never, "Asia/Shanghai");
    const shown = await handler({
      action: {
        tag: "overflow",
        option: "show_trend",
        value: {
          action: "card_tools",
          ranking_mode: "today",
          scope: "period",
          period_ids: "53,10",
          selected_period_id: "53",
          show_trend: "false",
        },
      },
    });
    expect(includeTrend).toBe(true);
    expect(shown.toast?.content).toBe("趋势图已显示");
    expect(JSON.stringify(shown.card?.data)).toContain('"tag":"chart"');
    expect(JSON.stringify(shown.card?.data)).toContain("隐藏趋势图");

    const hidden = await handler({
      action: {
        tag: "overflow",
        option: "hide_trend",
        value: {
          action: "card_tools",
          ranking_mode: "today",
          scope: "period",
          period_ids: "53,10",
          selected_period_id: "53",
          show_trend: "true",
        },
      },
    });
    expect(includeTrend).toBe(false);
    expect(hidden.toast?.content).toBe("趋势图已隐藏");
    expect(JSON.stringify(hidden.card?.data)).not.toContain('"tag":"chart"');

    const collapsed = await handler({
      action: {
        tag: "overflow",
        option: "show_trend",
        value: {
          action: "card_tools",
          ranking_mode: "today",
          scope: "period",
          period_ids: "53,10",
          selected_period_id: "53",
          show_trend: "false",
          return_view: "collapsed",
        },
      },
    });
    expect(JSON.stringify(collapsed.card?.data)).toContain("日报已收起");
    expect(JSON.stringify(collapsed.card?.data)).toContain('"show_trend":"true"');
  });

  test("切换项目后继续使用环境变量颜色和图标", async () => {
    const handler = createCardActionHandler(
      fakeReportService as never,
      "Asia/Shanghai",
      { 1: "red" },
      { 1: "img_v2_rok" },
    );
    const response = await handler({
      action: {
        tag: "select_static",
        option: "10",
        value: {
          action: "select_period",
          ranking_mode: "today",
          period_ids: "53,10",
          enable_forward: "true",
          enable_forward_interaction: "true",
        },
      },
    });
    expect((response.card?.data.config as Record<string, unknown>).enable_forward).toBe(true);
    expect((response.card?.data.config as Record<string, unknown>).enable_forward_interaction).toBe(true);
    expect((response.card?.data.header as Record<string, unknown>).template).toBe("red");
    expect((response.card?.data.header as Record<string, unknown>).icon).toEqual({
      tag: "custom_icon",
      img_key: "img_v2_rok",
    });
  });

  test("收起和展开卡片时保留当前项目视图", async () => {
    const handler = createCardActionHandler(fakeReportService as never, "Asia/Shanghai");
    const actionState = {
      ranking_mode: "period",
      scope: "period",
      period_ids: "53,10",
      selected_period_id: "53",
      return_view: "full",
    };
    const collapsed = await handler({
      action: {
        tag: "overflow",
        option: "collapse_card",
        value: { ...actionState, action: "card_tools" },
      },
    });
    expect(collapsed.toast?.content).toBe("卡片已收起");
    expect(JSON.stringify(collapsed.card?.data)).toContain("日报已收起");
    expect(JSON.stringify(collapsed.card?.data)).not.toContain("TOP · 视频播放");

    const expanded = await handler({
      action: {
        tag: "overflow",
        option: "expand_card",
        value: { ...actionState, action: "card_tools", return_view: "collapsed" },
      },
    });
    expect(expanded.toast?.content).toBe("卡片已展开");
    expect(JSON.stringify(expanded.card?.data)).toContain("本期 TOP · 视频播放");
  });

  test("撤回先显示确认卡片，取消后恢复原视图", async () => {
    const handler = createCardActionHandler(fakeReportService as never, "Asia/Shanghai");
    const actionState = {
      ranking_mode: "today",
      scope: "period",
      period_ids: "53,10",
      selected_period_id: "53",
      return_view: "collapsed",
    };
    const confirmation = await handler({
      action: {
        tag: "overflow",
        option: "request_recall",
        value: { ...actionState, action: "card_tools" },
      },
    });
    expect(confirmation.toast?.content).toBe("请确认是否撤回");
    expect(JSON.stringify(confirmation.card?.data)).toContain("撤回确认");

    const cancelled = await handler({
      action: {
        tag: "button",
        value: { ...actionState, action: "cancel_recall" },
      },
    });
    expect(cancelled.toast?.content).toBe("已取消撤回");
    expect(JSON.stringify(cancelled.card?.data)).toContain("日报已收起");
  });

  test("项目切换返回符合文档字段的折叠按钮组", async () => {
    const handler = createCardActionHandler(fakeReportService as never, "Asia/Shanghai");
    const response = await handler({
      action: {
        tag: "select_static",
        option: "10",
        value: {
          action: "select_period",
          ranking_mode: "today",
          period_ids: "53,10",
        },
      },
    });
    const json = JSON.stringify(response.card?.data);
    expect(response.toast?.type).toBe("success");
    expect(json).toContain('"tag":"overflow"');
    expect(json).toContain('"action":"card_tools"');
    expect(json).toContain('"width":"default"');
    expect(json).not.toContain('"element_id":"card_tools","size"');
  });

  test("确认撤回时使用回调消息 ID 且不再返回替换卡片", async () => {
    let recalledMessageId = "";
    const handler = createCardActionHandler(
      fakeReportService as never,
      "Asia/Shanghai",
      {},
      {},
      async (messageId) => {
        recalledMessageId = messageId;
      },
    );
    const response = await handler({
      context: { open_message_id: "om_daily_report" },
      action: {
        tag: "button",
        value: {
          action: "confirm_recall",
          ranking_mode: "today",
          scope: "period",
          period_ids: "53,10",
          selected_period_id: "53",
          return_view: "full",
        },
      },
    });
    expect(recalledMessageId).toBe("om_daily_report");
    expect(response.toast).toEqual({ type: "success", content: "日报卡片已撤回" });
    expect(response.card).toBeUndefined();
  });

  test("有消息更新能力时立即返回加载卡并在后台写入最终卡片", async () => {
    let resolveReports!: (reports: PeriodReport[]) => void;
    const pendingReports = new Promise<PeriodReport[]>((resolve) => {
      resolveReports = resolve;
    });
    const reportService = {
      listPeriods: async () => periods,
      buildReports: async () => pendingReports,
    };
    const updates: Array<{ messageId: string; json: string }> = [];
    const handler = createCardActionHandler(
      reportService as never,
      "Asia/Shanghai",
      {},
      {},
      undefined,
      async (messageId, card) => {
        updates.push({ messageId, json: JSON.stringify(card) });
      },
    );

    const response = await handler({
      context: { open_message_id: "om_async_report" },
      action: {
        tag: "overflow",
        option: "rank_yesterday",
        value: {
          action: "overflow_action",
          ranking_mode: "today",
          scope: "period",
          period_ids: "53,10",
          selected_period_id: "53",
        },
      },
    });

    expect(response.toast).toEqual({ type: "info", content: "正在更新日报" });
    expect(JSON.stringify(response.card?.data)).toContain("日报更新中");
    expect(updates).toHaveLength(0);

    resolveReports([makeReport(periods[0]!)]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.messageId).toBe("om_async_report");
    expect(updates[0]!.json).toContain("昨日 TOP · 视频播放");
  });

  test("后台取数失败时将加载卡替换为可重试的错误卡", async () => {
    const reportService = {
      listPeriods: async () => periods,
      buildReports: async () => {
        throw new Error("请求数据超时");
      },
    };
    let updatedJson = "";
    const handler = createCardActionHandler(
      reportService as never,
      "Asia/Shanghai",
      {},
      {},
      undefined,
      async (_messageId, card) => {
        updatedJson = JSON.stringify(card);
      },
    );

    const response = await handler({
      context: { open_message_id: "om_failed_report" },
      action: {
        tag: "overflow",
        option: "rank_today",
        value: {
          action: "overflow_action",
          ranking_mode: "period",
          scope: "period",
          period_ids: "53,10",
          selected_period_id: "53",
        },
      },
    });
    expect(JSON.stringify(response.card?.data)).toContain("日报更新中");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updatedJson).toContain("日报更新失败");
    expect(updatedJson).toContain("请求数据超时");
    expect(updatedJson).toContain("重新加载");
  });
});
