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
  test("视频播放保留单日口径，稿件和作者按相邻日期计算新增", async () => {
    const videoDates: Array<string | undefined> = [];
    const liveDates: Array<string | undefined> = [];
    const videoSummary = (playCount: number, contentCount = 0, authorCount = 0): VideoSummary => ({
      playCount,
      likeCount: 0,
      commentCount: 0,
      contentCount,
      authorCount,
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
        if (!range.date) return videoSummary(999, 962, 87);
        const today = dateInTimezone("Asia/Shanghai");
        const yesterday = previousIsoDate(today);
        if (range.date === today) return videoSummary(803_000, 962, 87);
        if (range.date === yesterday) return videoSummary(1_110_000, 928, 86);
        return videoSummary(908_000, 857, 86);
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
    const dayBeforeYesterday = previousIsoDate(yesterday);

    expect(videoDates).toContain(today);
    expect(videoDates).toContain(yesterday);
    expect(videoDates).toContain(dayBeforeYesterday);
    expect(liveDates).toContain(today);
    expect(liveDates).toContain(yesterday);
    expect(report?.range.yesterday).toBe(yesterday);
    expect(report?.video.today).toMatchObject({ playCount: 803_000, contentCount: 34, authorCount: 1 });
    expect(report?.video.yesterday).toMatchObject({ playCount: 1_110_000, contentCount: 71, authorCount: 0 });
    expect(report?.live.yesterday.liveExposurePv).toBe(20);
  });

  test("昨日日期可跨年回退", () => {
    expect(previousIsoDate("2026-01-01")).toBe("2025-12-31");
  });

  test("昨日 TOP 使用昨日日期查询", async () => {
    let rankingRange: { date?: string; from?: string; to?: string } = {};
    const client = {
      listProjectPeriods: async () => [period],
      listContents: async () => [{ contentConfigId: 100, activityPeriodId: 10, contentType: "video" }],
      getVideoSummary: async () => ({
        playCount: 0,
        likeCount: 0,
        commentCount: 0,
        contentCount: 0,
        authorCount: 0,
      }),
      getLiveSummary: async () => ({ liveExposurePv: 0, avgAcu: null, liveSessionCount: 0, anchorCount: 0 }),
      getTopGrowth: async (_id: number, range: typeof rankingRange) => {
        rankingRange = range;
        return [];
      },
    };
    const service = new ReportService(client as never, "Asia/Shanghai");
    await service.buildReports([10], "yesterday");
    expect(rankingRange).toEqual({ date: previousIsoDate(dateInTimezone("Asia/Shanghai")) });
  });

  test("趋势最多保留最近 31 天并计算每日稿件和作者新增", async () => {
    const today = dateInTimezone("Asia/Shanghai");
    let start = today;
    for (let index = 0; index < 40; index += 1) start = previousIsoDate(start);
    const trendPeriod = { ...period, trackingStartDate: start, trackingEndDate: today };
    const requestedDates: string[] = [];
    const ordinal = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
    const client = {
      listProjectPeriods: async () => [trendPeriod],
      listContents: async () => [{ contentConfigId: 100, activityPeriodId: 10, contentType: "video" }],
      getVideoSummary: async (_id: number, range: { date?: string }) => {
        if (!range.date) return { playCount: 999, likeCount: 0, commentCount: 0, contentCount: 999, authorCount: 999 };
        requestedDates.push(range.date);
        const day = ordinal(range.date);
        return { playCount: day, likeCount: 0, commentCount: 0, contentCount: day * 2, authorCount: day };
      },
      getLiveSummary: async () => ({ liveExposurePv: 0, avgAcu: null, liveSessionCount: 0, anchorCount: 0 }),
      getTopGrowth: async () => [],
    };
    const service = new ReportService(client as never, "Asia/Shanghai");
    const [result] = await service.buildReports([10], "today", true);
    expect(result?.video.trend).toHaveLength(31);
    expect(result?.video.trend.at(-1)).toMatchObject({ date: today, contentCount: 2, authorCount: 1 });
    expect(requestedDates).toContain(previousIsoDate(result!.video.trend[0]!.date));
  });
});
