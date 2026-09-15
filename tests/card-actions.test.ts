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

  test("本期增长选项覆盖当前排行模式", async () => {
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
    expect(JSON.stringify(response.card?.data)).toContain("本期增长 · 视频播放 Top 5");
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
});
