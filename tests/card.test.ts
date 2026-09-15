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
    range: {
      from: "2026-09-01",
      to: "2026-09-14",
      today: "2026-09-14",
      yesterday: "2026-09-13",
    },
    video: {
      cumulative: { playCount: 221_400, likeCount: 800, commentCount: 70, contentCount: 20, authorCount: 9 },
      today: { playCount: 12_040, likeCount: 90, commentCount: 8, contentCount: 5, authorCount: 4 },
      yesterday: { playCount: 9_800, likeCount: 70, commentCount: 6, contentCount: 3, authorCount: 2 },
      topGrowth: Array.from({ length: 7 }, (_, index) => ({
        contentConfigId: 15,
        videoId: `video-${index}`,
        publishTime: "2026-09-13T08:00:00",
        authorName: `作者${index}`,
        title: index === 0 ? "1234567890ABCDEFGHIJabcdefghij" : `视频标题 ${index}`,
        label: index === 0 ? "审核通过" : null,
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
      yesterday: { liveExposurePv: 750, avgAcu: 10, liveSessionCount: 2, anchorCount: 1 },
    },
  };
}

function reportWithoutLive(period: ProjectPeriod): PeriodReport {
  const value = report(period);
  value.live.cumulative = { liveExposurePv: 0, avgAcu: null, liveSessionCount: 0, anchorCount: 0 };
  return value;
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
    const config = card.config as Record<string, unknown>;
    expect(config.update_multi).toBe(true);
    expect(config.enable_forward).toBe(false);
    expect(config.enable_forward_interaction).toBe(false);
    expect(config.width_mode).toBeUndefined();
    expect(json).toContain("项目每日速览");
    expect(json).toContain("视频标题 4");
    expect(json).not.toContain("视频标题 5");
    expect(json).not.toContain("万国26年8月第十五期");
    expect(json).toContain("https://www.douyin.com/video/video-0");
    expect(json).toContain("发布 09/13 16:00");
    expect(json).toContain("1234567890AB…");
    expect(json).not.toContain("1234567890ABC");
    expect(json).not.toContain("abcdefghij");
    expect(json).toContain("<text_tag color='neutral'>审核通过</text_tag>");
    expect(json.match(/<text_tag color='neutral'>/g)).toHaveLength(2);
    expect(json).toContain('"corner_radius":"12px"');
    expect(json).toContain('"background_style":"cus-0"');
    expect(json).toContain('"light_mode":"rgba(240,246,255,0.88)"');
    expect(json).toContain('"flex_mode":"flow"');
    const fourColumnDailyRows = (card.body as { elements: Array<Record<string, unknown>> }).elements.filter(
      (element) =>
        element.tag === "column_set" &&
        element.flex_mode === "flow" &&
        element.margin === "2px 0" &&
        (element.columns as unknown[]).length === 4,
    );
    expect(fourColumnDailyRows).toHaveLength(2);
    expect(json).toContain("累计播放 2000");
    expect(json).toContain("作者0丨发布 09/13 16:00丨累计播放 2000丨今日新增");
    expect(json).not.toContain("作者0　·　发布");
    expect(json).toContain("22.1w");
    expect(json).toContain("+1.2w");
    expect(json).not.toContain("221,400");
    expect(json).toContain("今日新增");
    expect(json).toContain("昨日视频新增");
    expect(json).toContain("昨日新增直播");
    expect(json).toContain("统计区间 2026-09-01 — 2026-09-14");
    expect(json).not.toContain("今日增长与本期进度");
    expect(json).not.toContain("<text_align");
    expect(json).not.toContain("视频排行范围");
    expect(json).toContain("今日新增直播");
    expect(json).toContain("3 场");
    expect(json).toContain("2 位主播");
    expect(json).toContain("直播PV 1.2w");
    expect(json).not.toContain("直播曝光");
    expect(json).not.toContain("**+900**");
    expect(json).not.toContain("**+750**");
    expect(json).toContain("有疑问找");
    expect(json).toContain('"tag":"person"');
    expect(json).toContain('"size":"extra_small"');
    expect(json).toContain('"user_id":"ou_c909863fbf86e93840200f4d30a2229c"');
    expect(json).toContain('"show_name":true');
    expect(json).toContain('"style":"capsule"');
    expect(json.indexOf("有疑问找")).toBeLessThan(json.indexOf("卡片更新于"));
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
    expect(header.subtitle).toEqual({
      tag: "plain_text",
      content: "统计区间 2026-09-01 — 2026-09-14",
    });
    expect(header.text_tag_list).toBeUndefined();
    const json = JSON.stringify(card);
    expect(json).toContain("本期增长 · 视频播放 Top 5");
    expect(json).toContain("本期新增");
    expect(json).toContain("<text_tag color='neutral'>审核通过</text_tag>");
    expect(json).toContain('"flex_mode":"trisect"');
    expect(json).toContain("**800**</font>\\n<font color='grey'>点赞</font>");
    expect(json).toContain("**70**</font>\\n<font color='grey'>评论</font>");
    expect(json).toContain("**11.2**</font>\\n<font color='grey'>平均 ACU</font>");
    expect(json).not.toContain("<font color='grey'>点赞 800");
    expect(json).toContain('"flex_mode":"flow","horizontal_spacing":"6px","margin":"2px 0","columns"');
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

  test("超过四个项目时隐藏所有项目按钮", () => {
    const manyPeriods = Array.from({ length: 5 }, (_, index): ProjectPeriod => ({
      ...periods[0]!,
      activityPeriodId: 100 + index,
      projectId: 100 + index,
      projectDisplayName: `项目${index + 1}`,
      period: `项目${index + 1}日报`,
    }));
    const card = buildReportCard({
      reports: [report(manyPeriods[0]!)],
      allPeriods: manyPeriods,
      state: { scope: "period", periodIds: manyPeriods.map((item) => item.activityPeriodId), rankingMode: "today" },
    });
    expect(JSON.stringify(card)).not.toContain("所有项目");
  });

  test("静态卡片不包含切换控件或回调", () => {
    const card = buildReportCard({
      reports: [report(periods[0]!)],
      allPeriods: periods,
      state: { scope: "period", periodIds: [10], selectedPeriodId: 10, rankingMode: "today" },
      interactive: false,
    });
    const json = JSON.stringify(card);
    expect((card.config as Record<string, unknown>).update_multi).toBe(false);
    expect(json).not.toContain('"callback"');
    expect(json).not.toContain('"select_static"');
    expect(json).not.toContain("所有项目");
    expect(json).not.toContain("[ROK]生态");
  });

  test("项目颜色配置覆盖默认卡片主题和标签色", () => {
    const singleCard = buildReportCard({
      reports: [report(periods[0]!)],
      allPeriods: periods,
      state: { scope: "period", periodIds: [10], selectedPeriodId: 10, rankingMode: "today" },
      projectColors: { 1: "red" },
    });
    expect((singleCard.header as Record<string, unknown>).template).toBe("red");

    const combinedCard = buildReportCard({
      reports: periods.map(report),
      allPeriods: periods,
      state: { scope: "combined", periodIds: [10, 11], rankingMode: "today" },
      projectColors: { 1: "red", 2: "orange" },
    });
    const json = JSON.stringify(combinedCard);
    expect(json).toContain("<text_tag color='red'>");
    expect(json).toContain("<text_tag color='orange'>");
    expect(json).toContain('"color":"red"');
    expect(json).toContain('"color":"orange"');
  });

  test("单项目使用配置的标题图标，多项目总览保留默认图标", () => {
    const singleCard = buildReportCard({
      reports: [report(periods[0]!)],
      allPeriods: periods,
      state: { scope: "period", periodIds: [10], selectedPeriodId: 10, rankingMode: "today" },
      projectIcons: { 1: "img_v2_project_one" },
    });
    expect((singleCard.header as Record<string, unknown>).icon).toEqual({
      tag: "custom_icon",
      img_key: "img_v2_project_one",
    });

    const combinedCard = buildReportCard({
      reports: periods.map(report),
      allPeriods: periods,
      state: { scope: "combined", periodIds: [10, 11], rankingMode: "today" },
      projectIcons: { 1: "img_v2_project_one", 2: "img_v2_project_two" },
    });
    expect((combinedCard.header as Record<string, unknown>).icon).toEqual({
      tag: "standard_icon",
      token: "chart-pie_outlined",
    });
  });

  test("累计直播为空时隐藏单项目的所有直播板块", () => {
    const card = buildReportCard({
      reports: [reportWithoutLive(periods[0]!)],
      allPeriods: periods,
      state: { scope: "period", periodIds: [10], selectedPeriodId: 10, rankingMode: "today" },
    });
    const json = JSON.stringify(card);
    expect(json).not.toContain("直播");
    expect(json).not.toContain("主播");
    expect(json).not.toContain("平均 ACU");

    const dailyRow = (card.body as { elements: Array<Record<string, unknown>> }).elements.find(
      (element) =>
        element.tag === "column_set" &&
        element.margin === "2px 0" &&
        JSON.stringify(element).includes("今日视频新增"),
    );
    expect(dailyRow?.flex_mode).toBe("bisect");
    expect(dailyRow?.columns as unknown[]).toHaveLength(2);
  });

  test("累计直播为空时多项目紧凑卡也不展示直播板块", () => {
    const card = buildReportCard({
      reports: periods.map(reportWithoutLive),
      allPeriods: periods,
      state: { scope: "combined", periodIds: [10, 11], rankingMode: "today" },
    });
    const json = JSON.stringify(card);
    expect(json).not.toContain("直播");
    expect(json).not.toContain("主播");
    expect(json).not.toContain("平均 ACU");
  });
});
