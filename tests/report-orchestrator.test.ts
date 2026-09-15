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
    range: { from: "2026-09-01", to: "2026-09-15", today: "2026-09-15", yesterday: "2026-09-14" },
    video: { cumulative: video, today: video, yesterday: video, topGrowth: [] },
    live: { cumulative: live, today: live, yesterday: live },
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
      expect(JSON.stringify(card)).not.toContain('"callback"');
    }
  });
});
