import { describe, expect, test } from "bun:test";
import { buildReportCard } from "../src/card.ts";
import type { PeriodReport, ProjectPeriod } from "../src/types.ts";

const periods: ProjectPeriod[] = [
  {
    activityPeriodId: 10,
    projectId: 1,
    projectKey: "[ROK]万国觉醒创作营",
    projectDisplayName: "[ROK]生态",
    period: "万国26年9月第十六期",
    trackingStartDate: "2026-09-01",
    trackingEndDate: "2026-10-03",
    isLatest: true,
  },
  {
    activityPeriodId: 11,
    projectId: 2,
    projectKey: "[SAMO]万国觉醒创作营",
    projectDisplayName: "[SAMO]生态",
    period: "万龙26年9月第十六期",
    trackingStartDate: "2026-09-01",
    trackingEndDate: "2026-10-03",
    isLatest: true,
  },
];

const oldPeriod: ProjectPeriod = {
  ...periods[0]!,
  activityPeriodId: 2,
  period: "万国26年8月第十五期",
  isLatest: false,
};

function report(period: ProjectPeriod): PeriodReport {
  return {
    period,
    range: { from: "2026-09-01", to: "2026-09-14", today: "2026-09-14" },
    video: {
      cumulative: { playCount: 9000, likeCount: 800, commentCount: 70, contentCount: 20, authorCount: 9 },
      today: { playCount: 1200, likeCount: 90, commentCount: 8, contentCount: 5, authorCount: 4 },
      topGrowth: Array.from({ length: 7 }, (_, index) => ({
        contentConfigId: 15,
        videoId: `video-${index}`,
        publishTime: "2026-09-13T08:00:00",
        authorName: `作者${index}`,
        title: index === 0 ? "1234567890ABCDEFGHIJabcdefghij" : `视频标题 ${index}`,
        label: null,
        playGrowth: 1000 - index,
        avgDailyPlayGrowth: 1000 - index,
        metricDays: 1,
        latestPlayCount: 2000,
        latestStatDate: "2026-09-14",
      })),
    },
    live: {
      cumulative: { liveExposurePv: 12000, avgAcu: 11.2, liveSessionCount: 30, anchorCount: 8 },
      today: { liveExposurePv: 900, avgAcu: 12, liveSessionCount: 3, anchorCount: 2 },
    },
  };
}

describe("buildReportCard", () => {
  test("构建共享的 JSON 2.0 多合一卡片，并只展开每项目前 5 条", () => {
    const card = buildReportCard({
      reports: periods.map(report),
      allPeriods: [...periods, oldPeriod],
      state: { scope: "combined", periodIds: [10, 11], rankingMode: "today" },
      timezone: "Asia/Shanghai",
    });
    const json = JSON.stringify(card);
    expect(card.schema).toBe("2.0");
    expect((card.config as Record<string, unknown>).update_multi).toBe(true);
    expect(json).toContain("项目每日速览");
    expect(json).toContain("视频标题 4");
    expect(json).not.toContain("视频标题 5");
    expect(json).not.toContain("万国26年8月第十五期");
    expect(json).toContain("https://www.douyin.com/video/video-0");
    expect(json).toContain("发布 09/13 16:00");
    expect(json).toContain("1234567890…abcdefghij");
    expect(json).not.toContain("ABCDEFGHIJ");
    expect(json).toContain('"corner_radius":"12px"');
    expect(json).toContain('"background_style":"cus-0"');
    expect(json).toContain('"light_mode":"rgba(240,246,255,0.88)"');
    expect(json).toContain('"flex_mode":"flow"');
    expect(json).toContain('"flex_mode":"bisect"');
    expect(json).toContain("累计播放 2,000");
    expect(json).toContain("今日新增");
    expect(json).not.toContain("<text_align");
    expect(json).not.toContain("视频排行范围");
    expect(json).not.toContain("今日直播曝光");
    expect(json).toContain("3 场");
    expect(json).toContain("2 位主播");
    expect((card.body as { elements: unknown[] }).elements.length).toBeLessThan(30);
    expect(Buffer.byteLength(json)).toBeLessThan(30 * 1024);
  });

  test("单项目标题使用 period，项目 1 使用金色主题", () => {
    const card = buildReportCard({
      reports: [report(periods[0]!)],
      allPeriods: periods,
      state: { scope: "period", periodIds: [10], selectedPeriodId: 10, rankingMode: "period" },
    });
    const header = card.header as Record<string, unknown>;
    expect(header.template).toBe("yellow");
    expect(header.title).toEqual({ tag: "plain_text", content: "万国26年9月第十六期" });
    const json = JSON.stringify(card);
    expect(json).toContain("本期增长 · 视频播放 Top 5");
    expect(json).toContain("本期新增");
    expect(json).toContain("[ROK]生态");
    expect(json).not.toContain("\\[ROK\\]生态");
  });

  test("交互组件携带期次和排行视图状态", () => {
    const card = buildReportCard({
      reports: [report(periods[1]!)],
      allPeriods: periods,
      state: { scope: "period", periodIds: [10, 11], selectedPeriodId: 11, rankingMode: "today" },
    });
    const json = JSON.stringify(card);
    expect(json).toContain('"action":"select_period"');
    expect(json).toContain('"period_ids":"10,11"');
    expect(json).toContain('"action":"show_latest"');
    expect(json).toContain('"action":"set_ranking"');
    expect(json).toContain("所有项目");
  });
});
