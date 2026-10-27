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

function findElementById(value: unknown, elementId: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findElementById(item, elementId);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.element_id === elementId) return record;
  for (const child of Object.values(record)) {
    const found = findElementById(child, elementId);
    if (found) return found;
  }
  return undefined;
}

describe("ReportOrchestrator", () => {
  test("单独日报只保留页脚折叠操作", async () => {
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
      expect((card.config as Record<string, unknown>).update_multi).toBe(true);
      expect((card.config as Record<string, unknown>).enable_forward).toBe(true);
      expect((card.config as Record<string, unknown>).enable_forward_interaction).toBe(true);
      const json = JSON.stringify(card);
      expect(json).toContain('"callback"');
      expect(json).toContain('"element_id":"card_tools"');
      expect(json).toContain("收起卡片");
      expect(json).toContain("撤回卡片");
      expect(json).not.toContain('"tag":"select_static"');
      expect(json).not.toContain('"element_id":"rank_today"');
      expect(json).toContain('"tag":"chart"');
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

  test("私聊卡片强制禁止转发", async () => {
    const reportService = {
      listPeriods: async () => periods,
      buildReports: async (ids: number[]) => ids.map((id) => report(periods.find((item) => item.activityPeriodId === id)!)),
    };
    const orchestrator = new ReportOrchestrator(reportService as never, undefined, "Asia/Shanghai");
    const [card] = await orchestrator.createCards({
      periodIds: [periods[0]!.activityPeriodId],
      mode: "combined",
      rankingMode: "today",
      enableForward: true,
      enableForwardInteraction: true,
      isPrivateChat: true,
    });
    expect((card!.config as Record<string, unknown>).enable_forward).toBe(false);
    expect((card!.config as Record<string, unknown>).enable_forward_interaction).toBe(false);
  });

  test("多合一日报可将同一项目的两个期次直接放在一张卡中", async () => {
    const earlierPeriod: ProjectPeriod = {
      ...periods[0]!,
      activityPeriodId: 9,
      period: "项目 1 上一期日报",
      isLatest: false,
    };
    const availablePeriods = [periods[0]!, earlierPeriod, periods[1]!];
    let builtIds: number[] = [];
    const reportService = {
      listPeriods: async () => availablePeriods,
      buildReports: async (ids: number[]) => {
        builtIds = ids;
        return ids.map((id) => report(availablePeriods.find((item) => item.activityPeriodId === id)!));
      },
    };
    const orchestrator = new ReportOrchestrator(reportService as never, undefined, "Asia/Shanghai");
    const [card] = await orchestrator.createCards({
      periodIds: [10, 9],
      mode: "combined",
      rankingMode: "today",
    });
    const json = JSON.stringify(card);

    expect(builtIds).toEqual([10, 9]);
    expect((card!.header as { title: { content: string } }).title.content).toBe("项目 1 · 多期速览");
    expect(json).toContain("项目 1 日报");
    expect(json).toContain("项目 1 上一期日报");
    expect(json).toContain("全部期次");
  });

  test("同一项目不能同时选择三个期次", async () => {
    const availablePeriods = [8, 9, 10].map((activityPeriodId) => ({
      ...periods[0]!,
      activityPeriodId,
      period: `项目 1 第 ${activityPeriodId} 期`,
      isLatest: activityPeriodId === 10,
    }));
    const reportService = {
      listPeriods: async () => availablePeriods,
      buildReports: async () => [],
    };
    const orchestrator = new ReportOrchestrator(reportService as never, undefined, "Asia/Shanghai");

    await expect(orchestrator.createCards({
      periodIds: [8, 9, 10],
      mode: "combined",
      rankingMode: "today",
    })).rejects.toThrow("最多可同时选择两个期次");
  });

  test("项目指令可直接展开多个项目的多合一卡片", async () => {
    let builtIds: number[] = [];
    const reportService = {
      listPeriods: async () => periods,
      buildReports: async (ids: number[]) => {
        builtIds = ids;
        return ids.map((id) => report(periods.find((item) => item.activityPeriodId === id)!));
      },
    };
    const orchestrator = new ReportOrchestrator(reportService as never, undefined, "Asia/Shanghai");
    const [card] = await orchestrator.createCards({
      periodIds: [10, 20],
      mode: "combined",
      rankingMode: "today",
      showAllSelected: true,
    });

    expect(builtIds).toEqual([10, 20]);
    expect((card!.header as { title: { content: string } }).title.content).toBe("项目每日速览");
    expect(JSON.stringify(card)).toContain("项目 1 日报");
    expect(JSON.stringify(card)).toContain("项目 2 日报");
  });

  test("每个话题关键词生成独立卡片并传入对应看板链接", async () => {
    const builtTopics: Array<string | undefined> = [];
    const reportService = {
      listPeriods: async () => periods,
      buildReports: async (
        ids: number[],
        _ranking: string,
        _trend: boolean,
        _date: string,
        topicKeyword?: string,
      ) => {
        builtTopics.push(topicKeyword);
        return ids.map((id) => report(periods.find((item) => item.activityPeriodId === id)!));
      },
    };
    const orchestrator = new ReportOrchestrator(reportService as never, undefined, "Asia/Shanghai");
    const cards = await orchestrator.createCards({
      periodIds: [10],
      mode: "combined",
      rankingMode: "today",
      topicKeywords: ["#塔塔万圣捣蛋时刻", "养萌物来塔塔"],
    });

    expect(cards).toHaveLength(2);
    expect(builtTopics).toEqual(["塔塔万圣捣蛋时刻", "养萌物来塔塔"]);
    for (const [index, topic] of ["塔塔万圣捣蛋时刻", "养萌物来塔塔"].entries()) {
      const card = cards[index]!;
      const dashboard = findElementById(card, "project_dashboard") as {
        behaviors: Array<{ default_url: string }>;
      };
      const appLink = new URL(dashboard.behaviors[0]!.default_url);
      const target = new URL(appLink.searchParams.get("lk_target_url")!);
      expect(target.searchParams.get("topics")).toBe(JSON.stringify([topic]));
      expect(target.searchParams.has("topic_match")).toBe(false);
      expect(JSON.stringify(card.header)).toContain(`#${topic}`);
    }
  });

  test("按项目保存的每日计划会在执行时解析最新期次", async () => {
    let requestedProjectIds: number[] | undefined;
    const reportService = {
      listPeriods: async () => periods,
      latestPeriods: async (projectIds?: number[]) => {
        requestedProjectIds = projectIds;
        return periods.filter((item) => projectIds?.includes(item.projectId));
      },
      buildReports: async (ids: number[]) => ids.map((id) => report(periods.find((item) => item.activityPeriodId === id)!)),
    };
    const orchestrator = new ReportOrchestrator(reportService as never, undefined, "Asia/Shanghai");
    const cards = await orchestrator.createCards({
      periodIds: [],
      projectIds: [2],
      mode: "combined",
      rankingMode: "today",
    });

    expect(requestedProjectIds).toEqual([2]);
    expect(cards).toHaveLength(1);
    expect((cards[0]!.header as { title: { content: string } }).title.content).toBe("项目 2 日报");
  });
});
