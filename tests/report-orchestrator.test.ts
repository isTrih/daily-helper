import { describe, expect, test } from "bun:test";
import { ReportOrchestrator } from "../src/report-orchestrator.ts";
import type { PeriodReport, ProjectPeriod } from "../src/types.ts";

const periods: ProjectPeriod[] = [1, 2].map((projectId) => ({
  activityPeriodId: projectId * 10,
  projectId,
  projectKey: `project-${projectId}`,
  projectDisplayName: `项目 ${projectId}`,
  period: `项目 ${projectId} 日报`,
  isLatest: true,
}));

function report(period: ProjectPeriod): PeriodReport {
  const video = { playCount: 0, likeCount: 0, commentCount: 0, contentCount: 0, authorCount: 0 };
  const live = { liveExposurePv: 0, avgAcu: null, liveSessionCount: 0, anchorCount: 0 };
  return {
    period,
    range: {
      from: "2026-09-01",
      to: "2026-09-15",
      today: "2026-09-15",
      yesterday: "2026-09-14",
      dayBefore: "2026-09-13",
    },
    video: {
      cumulative: video,
      today: video,
      yesterday: video,
      dayBefore: video,
      topGrowth: [],
      trend: [
        { date: "2026-09-14", playCount: 10, contentCount: 1, authorCount: 1 },
        { date: "2026-09-15", playCount: 20, contentCount: 2, authorCount: 1 },
      ],
    },
    live: { cumulative: live, today: live, yesterday: live, dayBefore: live },
  };
}

describe("ReportOrchestrator", () => {
  test("单独日报生成无交互卡片", async () => {
    const reportService = {
      listPeriods: async () => periods,
      buildReports: async (ids: number[]) => ids.map((id) => report(periods.find((item) => item.activityPeriodId === id)!)),
    };
    const orchestrator = new ReportOrchestrator(
      reportService as never,
      undefined,
      "Asia/Shanghai",
      { 1: "red", 2: "orange" },
      { 1: "img_v2_one", 2: "img_v2_two" },
    );
    const cards = await orchestrator.createCards({
      periodIds: periods.map((item) => item.activityPeriodId),
      mode: "single",
      rankingMode: "today",
      enableForward: true,
      enableForwardInteraction: true,
      showTrend: true,
    });

    expect(cards).toHaveLength(2);
    expect((cards[0]!.header as Record<string, unknown>).template).toBe("red");
    expect((cards[1]!.header as Record<string, unknown>).template).toBe("orange");
    expect((cards[0]!.header as Record<string, unknown>).icon).toEqual({
      tag: "custom_icon",
      img_key: "img_v2_one",
    });
    for (const card of cards) {
      expect((card.config as Record<string, unknown>).update_multi).toBeUndefined();
      expect((card.config as Record<string, unknown>).enable_forward).toBe(true);
      expect((card.config as Record<string, unknown>).enable_forward_interaction).toBe(true);
      expect(JSON.stringify(card)).not.toContain('"callback"');
      expect(JSON.stringify(card)).toContain('"tag":"chart"');
    }
  });

  test("关闭转发时忽略转发后交互设置", async () => {
    const reportService = {
      listPeriods: async () => periods,
      buildReports: async (ids: number[]) => ids.map((id) => report(periods.find((item) => item.activityPeriodId === id)!)),
    };
    const orchestrator = new ReportOrchestrator(reportService as never, undefined, "Asia/Shanghai");
    const [card] = await orchestrator.createCards({
      periodIds: [periods[0]!.activityPeriodId],
      mode: "combined",
      rankingMode: "today",
      enableForward: false,
      enableForwardInteraction: true,
    });
    expect((card!.config as Record<string, unknown>).enable_forward).toBe(false);
    expect((card!.config as Record<string, unknown>).enable_forward_interaction).toBe(false);
  });
});
