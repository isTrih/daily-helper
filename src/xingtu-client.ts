import { z } from "zod";
import type {
  ContentConfig,
  LiveSummary,
  ProjectPeriod,
  VideoGrowth,
  VideoWithMetrics,
  VideoSummary,
} from "./types.ts";

const projectSchema = z.object({
  activity_period_id: z.number().int(),
  project_id: z.number().int(),
  project_key: z.string(),
  project_display_name: z.string(),
  period: z.string(),
});

const periodDetailsSchema = z.object({
  activity_period_id: z.number().int(),
  period_code: z.string().nullish(),
  task_month: z.string().nullish(),
  tracking_start_date: z.string().nullish(),
  tracking_end_date: z.string().nullish(),
});

const contentSchema = z.object({
  content_config_id: z.number().int(),
  activity_period_id: z.number().int(),
  content_type: z.enum(["video", "live"]),
});

const videoSummarySchema = z.object({
  play_count: z.number().int(),
  like_count: z.number().int(),
  comment_count: z.number().int(),
  content_count: z.number().int(),
  author_count: z.number().int(),
});

const liveSummarySchema = z.object({
  live_exposure_pv: z.number().int(),
  avg_acu: z.number().nullable().optional(),
  live_session_count: z.number().int(),
  anchor_count: z.number().int(),
});

const videoGrowthSchema = z.object({
  content_config_id: z.number().int(),
  video_id: z.string(),
  publish_time: z.string(),
  author_name: z.string().nullish(),
  title: z.string().nullish(),
  label: z.string().nullish(),
  play_growth: z.number().int(),
  avg_daily_play_growth: z.number().nullish(),
  metric_days: z.number().int(),
  latest_play_count: z.number().int().nullish(),
  latest_stat_date: z.string().nullish(),
});

const videoMetricPointSchema = z.object({
  stat_date: z.string(),
  is_daily_final: z.boolean(),
  play_count: z.number().int().nullish(),
  play_increment: z.number().int().nullish(),
  like_count: z.number().int().nullish(),
  like_increment: z.number().int().nullish(),
  comment_count: z.number().int().nullish(),
  comment_increment: z.number().int().nullish(),
});

const videoWithMetricsSchema = z.object({
  content_config_id: z.number().int(),
  video_id: z.string(),
  publish_time: z.string(),
  author_uid: z.string().nullish(),
  author_name: z.string().nullish(),
  title: z.string().nullish(),
  label: z.string().nullish(),
  latest_play_count: z.number().int().nullish(),
  metrics: z.array(videoMetricPointSchema),
});

type SearchValue = string | number | boolean | null | undefined;

export class XingtuClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async listProjectPeriods(): Promise<ProjectPeriod[]> {
    const [projects, details] = await Promise.all([
      this.get("/api/v1/queries/projects", z.array(projectSchema)),
      this.get("/api/v1/queries/periods", z.array(periodDetailsSchema)),
    ]);
    const detailsById = new Map(details.map((item) => [item.activity_period_id, item]));
    const latestByProject = new Map<number, number>();

    for (const project of projects) {
      const current = latestByProject.get(project.project_id) ?? Number.NEGATIVE_INFINITY;
      latestByProject.set(project.project_id, Math.max(current, project.activity_period_id));
    }

    return projects
      .map((project): ProjectPeriod => {
        const detail = detailsById.get(project.activity_period_id);
        return {
          activityPeriodId: project.activity_period_id,
          projectId: project.project_id,
          projectKey: project.project_key,
          projectDisplayName: project.project_display_name,
          period: project.period,
          ...(detail?.period_code ? { periodCode: detail.period_code } : {}),
          ...(detail?.task_month ? { taskMonth: detail.task_month } : {}),
          ...(detail?.tracking_start_date ? { trackingStartDate: detail.tracking_start_date } : {}),
          ...(detail?.tracking_end_date ? { trackingEndDate: detail.tracking_end_date } : {}),
          isLatest: latestByProject.get(project.project_id) === project.activity_period_id,
        };
      })
      .sort((a, b) => b.activityPeriodId - a.activityPeriodId);
  }

  async listContents(): Promise<ContentConfig[]> {
    const items = await this.get("/api/v1/queries/contents", z.array(contentSchema));
    return items.map((item) => ({
      contentConfigId: item.content_config_id,
      activityPeriodId: item.activity_period_id,
      contentType: item.content_type,
    }));
  }

  async getVideoSummary(contentConfigId: number, range: { date?: string; from?: string; to?: string }) {
    const item = await this.get("/api/v1/queries/videos/summary", videoSummarySchema, {
      content_config_id: contentConfigId,
      date: range.date,
      date_from: range.from,
      date_to: range.to,
    });
    return mapVideoSummary(item);
  }

  async getLiveSummary(contentConfigId: number, range: { date?: string; from?: string; to?: string }) {
    const item = await this.get("/api/v1/queries/lives/summary", liveSummarySchema, {
      content_config_id: contentConfigId,
      date: range.date,
      date_from: range.from,
      date_to: range.to,
    });
    return mapLiveSummary(item);
  }

  async getTopGrowth(
    contentConfigId: number,
    range: { date?: string; from?: string; to?: string },
    limit = 5,
  ): Promise<VideoGrowth[]> {
    const items = await this.get("/api/v1/queries/videos/top-growth", z.array(videoGrowthSchema), {
      content_config_id: contentConfigId,
      date: range.date,
      date_from: range.from,
      date_to: range.to,
      limit,
    });
    return items.map((item) => ({
      contentConfigId: item.content_config_id,
      videoId: item.video_id,
      publishTime: item.publish_time,
      authorName: item.author_name ?? null,
      title: item.title ?? null,
      label: item.label ?? null,
      playGrowth: item.play_growth,
      avgDailyPlayGrowth: item.avg_daily_play_growth ?? null,
      metricDays: item.metric_days,
      latestPlayCount: item.latest_play_count ?? null,
      latestStatDate: item.latest_stat_date ?? null,
    }));
  }

  async getVideosWithMetrics(
    contentConfigId: number,
    range: { date?: string; from?: string; to?: string },
  ): Promise<VideoWithMetrics[]> {
    const pageSize = 500;
    const values: VideoWithMetrics[] = [];
    for (let offset = 0; offset < 5_000; offset += pageSize) {
      const items = await this.get("/api/v1/queries/videos/with-metrics", z.array(videoWithMetricsSchema), {
        content_config_id: contentConfigId,
        date: range.date,
        date_from: range.from,
        date_to: range.to,
        limit: pageSize,
        offset,
        metrics_mode: "history",
      });
      values.push(...items.map(mapVideoWithMetrics));
      if (items.length < pageSize) break;
    }
    return values;
  }

  private async get<T>(path: string, schema: z.ZodType<T>, query: Record<string, SearchValue> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`星图 API 请求失败（HTTP ${response.status}）`);
    }

    const json: unknown = await response.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`星图 API 响应结构异常 (${path}): ${z.prettifyError(parsed.error)}`);
    }
    return parsed.data;
  }
}

const EMPTY_VIDEO_SUMMARY: VideoSummary = {
  playCount: 0,
  likeCount: 0,
  commentCount: 0,
  contentCount: 0,
  authorCount: 0,
};

const EMPTY_LIVE_SUMMARY: LiveSummary = {
  liveExposurePv: 0,
  avgAcu: null,
  liveSessionCount: 0,
  anchorCount: 0,
};

export function emptyVideoSummary(): VideoSummary {
  return { ...EMPTY_VIDEO_SUMMARY };
}

export function emptyLiveSummary(): LiveSummary {
  return { ...EMPTY_LIVE_SUMMARY };
}

function mapVideoSummary(item: z.infer<typeof videoSummarySchema>): VideoSummary {
  return {
    playCount: item.play_count,
    likeCount: item.like_count,
    commentCount: item.comment_count,
    contentCount: item.content_count,
    authorCount: item.author_count,
  };
}

function mapLiveSummary(item: z.infer<typeof liveSummarySchema>): LiveSummary {
  return {
    liveExposurePv: item.live_exposure_pv,
    avgAcu: item.avg_acu ?? null,
    liveSessionCount: item.live_session_count,
    anchorCount: item.anchor_count,
  };
}

function mapVideoWithMetrics(item: z.infer<typeof videoWithMetricsSchema>): VideoWithMetrics {
  return {
    contentConfigId: item.content_config_id,
    videoId: item.video_id,
    publishTime: item.publish_time,
    authorUid: item.author_uid ?? null,
    authorName: item.author_name ?? null,
    title: item.title ?? null,
    label: item.label ?? null,
    latestPlayCount: item.latest_play_count ?? null,
    metrics: item.metrics.map((metric) => ({
      statDate: metric.stat_date,
      isDailyFinal: metric.is_daily_final,
      playCount: metric.play_count ?? null,
      playIncrement: metric.play_increment ?? null,
      likeCount: metric.like_count ?? null,
      likeIncrement: metric.like_increment ?? null,
      commentCount: metric.comment_count ?? null,
      commentIncrement: metric.comment_increment ?? null,
    })),
  };
}
