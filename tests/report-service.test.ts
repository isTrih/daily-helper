import { describe, expect, test } from "bun:test";
import { dateInTimezone, previousIsoDate, ReportService } from "../src/report-service.ts";
import type { LiveSummary, ProjectPeriod, VideoSummary } from "../src/types.ts";

const period: ProjectPeriod = {
  activityPeriodId: 10,
  projectId: 1,
  projectKey: "project-1",
  projectDisplayName: "项目 1",
  period: "项目 1 日报",
  trackingStartDate: "2026-09-01",
  trackingEndDate: "2026-12-31",
  isLatest: true,
};

describe("ReportService", () => {
  test("并发查询今日与昨日的视频和直播汇总", async () => {
    const videoDates: Array<string | undefined> = [];
    const liveDates: Array<string | undefined> = [];
    const videoSummary = (playCount: number): VideoSummary => ({
      playCount,
      likeCount: 0,
      commentCount: 0,
      contentCount: 0,
      authorCount: 0,
    });
    const liveSummary = (liveExposurePv: number): LiveSummary => ({
      liveExposurePv,
      avgAcu: null,
      liveSessionCount: 0,
      anchorCount: 0,
    });
    const client = {
      listProjectPeriods: async () => [period],
      listContents: async () => [
        { contentConfigId: 100, activityPeriodId: 10, contentType: "video" },
        { contentConfigId: 200, activityPeriodId: 10, contentType: "live" },
      ],
      getVideoSummary: async (_id: number, range: { date?: string }) => {
        videoDates.push(range.date);
        return videoSummary(range.date ? 10 : 100);
      },
      getLiveSummary: async (_id: number, range: { date?: string }) => {
        liveDates.push(range.date);
        return liveSummary(range.date ? 20 : 200);
      },
      getTopGrowth: async () => [],
    };
    const service = new ReportService(client as never, "Asia/Shanghai");
    const [report] = await service.buildReports([10], "today");
    const today = dateInTimezone("Asia/Shanghai");
    const yesterday = previousIsoDate(today);

    expect(videoDates).toContain(today);
    expect(videoDates).toContain(yesterday);
    expect(liveDates).toContain(today);
    expect(liveDates).toContain(yesterday);
    expect(report?.range.yesterday).toBe(yesterday);
    expect(report?.video.yesterday.playCount).toBe(10);
    expect(report?.live.yesterday.liveExposurePv).toBe(20);
  });

  test("昨日日期可跨年回退", () => {
    expect(previousIsoDate("2026-01-01")).toBe("2025-12-31");
  });
});
