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
    },
    video: {
      cumulative: { playCount: 100, likeCount: 10, commentCount: 2, contentCount: 3, authorCount: 2 },
      today: { playCount: 20, likeCount: 2, commentCount: 1, contentCount: 1, authorCount: 1 },
      yesterday: { playCount: 15, likeCount: 1, commentCount: 1, contentCount: 1, authorCount: 1 },
      topGrowth: [],
    },
    live: {
      cumulative: { liveExposurePv: 200, avgAcu: 3, liveSessionCount: 4, anchorCount: 2 },
      today: { liveExposurePv: 0, avgAcu: null, liveSessionCount: 1, anchorCount: 1 },
      yesterday: { liveExposurePv: 50, avgAcu: 2, liveSessionCount: 1, anchorCount: 1 },
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
        },
      },
    });
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
});
