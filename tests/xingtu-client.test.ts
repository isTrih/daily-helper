import { afterAll, describe, expect, test } from "bun:test";
import { dateInTimezone } from "../src/report-service.ts";
import { XingtuClient } from "../src/xingtu-client.ts";

const seenUrls: string[] = [];
const seenAuthorization: string[] = [];
const mockServer = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    seenUrls.push(url.pathname + url.search);
    seenAuthorization.push(request.headers.get("authorization") ?? "");
    if (url.pathname === "/api/v1/queries/projects") {
      return Response.json([
        { activity_period_id: 2, project_id: 1, project_key: "P1", project_display_name: "项目1", period: "旧期" },
        { activity_period_id: 10, project_id: 1, project_key: "P1", project_display_name: "项目1", period: "新期" },
        { activity_period_id: 3, project_id: 2, project_key: "P2", project_display_name: "项目2", period: "当前期" },
      ]);
    }
    if (url.pathname === "/api/v1/queries/periods") {
      return Response.json([
        { activity_period_id: 2, task_month: "2026-08-01", tracking_start_date: "2026-08-01", tracking_end_date: "2026-09-03" },
        { activity_period_id: 10, task_month: "2026-09-01", tracking_start_date: "2026-09-01", tracking_end_date: "2026-10-03" },
        { activity_period_id: 3, task_month: "2026-09-01", tracking_start_date: "2026-09-01", tracking_end_date: "2026-10-03" },
      ]);
    }
    if (url.pathname === "/api/v1/queries/videos/top-growth") {
      return Response.json([
        {
          content_config_id: 15,
          video_id: "v1",
          publish_time: "2026-09-13T08:00:00",
          author_name: "作者",
          title: "标题",
          label: "攻略",
          play_growth: 123,
          avg_daily_play_growth: 123,
          metric_days: 1,
          latest_play_count: 456,
          latest_stat_date: "2026-09-14",
        },
      ]);
    }
    if (url.pathname === "/api/v1/queries/videos/with-metrics") {
      return Response.json([
        {
          content_config_id: 15,
          video_id: "topic-v1",
          publish_time: "2026-09-13T08:00:00",
          author_uid: "author-1",
          author_name: "作者",
          title: "#塔塔万圣捣蛋时刻",
          label: "攻略",
          latest_play_count: 456,
          metrics: [
            {
              stat_date: "2026-09-14",
              is_daily_final: true,
              play_count: 456,
              play_increment: 123,
              like_count: 20,
              like_increment: 5,
              comment_count: 3,
              comment_increment: 1,
            },
          ],
        },
      ]);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
});

const client = new XingtuClient(`http://127.0.0.1:${mockServer.port}`, "test-token");

afterAll(() => mockServer.stop(true));

describe("XingtuClient", () => {
  test("同一 project 以最大的 activity_period_id 标记最新期次", async () => {
    const periods = await client.listProjectPeriods();
    expect(periods.find((period) => period.activityPeriodId === 10)?.isLatest).toBe(true);
    expect(periods.find((period) => period.activityPeriodId === 2)?.isLatest).toBe(false);
    expect(periods.find((period) => period.activityPeriodId === 3)?.isLatest).toBe(true);
    expect(seenAuthorization.slice(-2)).toEqual(["Bearer test-token", "Bearer test-token"]);
  });

  test("Top Growth 请求使用内容配置、日期和 limit=5", async () => {
    const result = await client.getTopGrowth(15, { date: "2026-09-14" }, 5);
    expect(result[0]?.playGrowth).toBe(123);
    expect(seenUrls).toContain(
      "/api/v1/queries/videos/top-growth?content_config_id=15&date=2026-09-14&limit=5",
    );
    expect(seenAuthorization.at(-1)).toBe("Bearer test-token");
  });

  test("视频指标明细使用 JWT 并映射逐日增量", async () => {
    const result = await client.getVideosWithMetrics(15, { from: "2026-09-01", to: "2026-09-14" });
    expect(result[0]?.metrics[0]).toMatchObject({
      statDate: "2026-09-14",
      playCount: 456,
      playIncrement: 123,
    });
    expect(seenUrls).toContain(
      "/api/v1/queries/videos/with-metrics?content_config_id=15&date_from=2026-09-01&date_to=2026-09-14&limit=500&offset=0&metrics_mode=history",
    );
    expect(seenAuthorization.at(-1)).toBe("Bearer test-token");
  });
});

test("北京时间日期格式稳定", () => {
  expect(dateInTimezone("Asia/Shanghai", new Date("2026-09-13T16:30:00Z"))).toBe("2026-09-14");
});
