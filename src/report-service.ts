import type {
  PeriodReport,
  ProjectPeriod,
  RankingMode,
  VideoGrowth,
  VideoSummary,
  VideoTrendPoint,
  VideoWithMetrics,
} from "./types.ts";
import { emptyLiveSummary, emptyVideoSummary, XingtuClient } from "./xingtu-client.ts";
import { matchesTopicKeyword, normalizeTopicKeyword } from "./topics.ts";

interface MetadataCache {
  expiresAt: number;
  periods: ProjectPeriod[];
  contents: Awaited<ReturnType<XingtuClient["listContents"]>>;
}

interface ReportCacheEntry {
  expiresAt: number;
  value: PeriodReport;
}

export class ReportService {
  private metadataCache?: MetadataCache;
  private readonly reportCache = new Map<string, ReportCacheEntry>();

  constructor(
    private readonly client: XingtuClient,
    private readonly timezone = "Asia/Shanghai",
    private readonly cacheTtlMs = 45_000,
    private readonly projectOrder: number[] = [],
  ) {}

  async listPeriods(force = false): Promise<ProjectPeriod[]> {
    const metadata = await this.getMetadata(force);
    return [...metadata.periods].sort((a, b) => this.compareProjects(a.projectId, b.projectId)
      || b.activityPeriodId - a.activityPeriodId);
  }

  async latestPeriods(projectIds?: number[]): Promise<ProjectPeriod[]> {
    const periods = await this.listPeriods();
    const allowed = projectIds && projectIds.length > 0 ? new Set(projectIds) : undefined;
    return periods
      .filter((period) => period.isLatest && (!allowed || allowed.has(period.projectId)))
      .sort((a, b) => this.compareProjects(a.projectId, b.projectId));
  }

  async buildReports(
    periodIds: number[],
    rankingMode: RankingMode,
    includeTrend = false,
    reportDate = dateInTimezone(this.timezone),
    topicKeyword?: string,
  ): Promise<PeriodReport[]> {
    if (!isIsoDate(reportDate)) throw new Error("日报日期无效");
    const metadata = await this.getMetadata();
    const uniqueIds = [...new Set(periodIds)];
    const byId = new Map(metadata.periods.map((period) => [period.activityPeriodId, period]));
    const unknownIds = uniqueIds.filter((id) => !byId.has(id));
    if (unknownIds.length > 0) {
      throw new Error(`找不到活动期次：${unknownIds.join(", ")}`);
    }

    const reports = await Promise.all(
      uniqueIds.map((id) => this.buildPeriodReport(
        byId.get(id)!,
        metadata.contents,
        rankingMode,
        includeTrend,
        reportDate,
        topicKeyword,
      )),
    );
    return reports.sort((a, b) => this.compareProjects(a.period.projectId, b.period.projectId));
  }

  private async buildPeriodReport(
    period: ProjectPeriod,
    contents: MetadataCache["contents"],
    rankingMode: RankingMode,
    includeTrend: boolean,
    reportDate: string,
    topicKeyword?: string,
  ): Promise<PeriodReport> {
    const normalizedTopic = topicKeyword ? normalizeTopicKeyword(topicKeyword) : "";
    const cacheKey = `${period.activityPeriodId}:${rankingMode}:${includeTrend ? "trend" : "plain"}:${reportDate}:${normalizedTopic.toLocaleLowerCase("zh-CN")}`;
    const cached = this.reportCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const today = reportDate;
    const yesterday = previousIsoDate(today);
    const dayBeforeYesterday = previousIsoDate(yesterday);
    const twoDaysBeforeYesterday = previousIsoDate(dayBeforeYesterday);
    const from = period.trackingStartDate ?? period.taskMonth ?? today;
    const configuredEnd = period.trackingEndDate ?? today;
    const to = today < from ? from : minIsoDate(today, configuredEnd);
    const videoConfig = contents.find(
      (item) => item.activityPeriodId === period.activityPeriodId && item.contentType === "video",
    );
    const liveConfig = contents.find(
      (item) => item.activityPeriodId === period.activityPeriodId && item.contentType === "live",
    );

    if (normalizedTopic) {
      const metricsFrom = minIsoDate(previousIsoDate(from), twoDaysBeforeYesterday);
      const metricsTo = today > to ? today : to;
      const videos = videoConfig
        ? (await this.client.getVideosWithMetrics(videoConfig.contentConfigId, {
            from: metricsFrom,
            to: metricsTo,
          })).filter((video) => matchesTopicKeyword(video.title, normalizedTopic))
        : [];
      const videoToday = summarizeTopicVideos(videos, today, today);
      const videoYesterday = summarizeTopicVideos(videos, yesterday, yesterday);
      const videoDayBeforeYesterday = summarizeTopicVideos(videos, dayBeforeYesterday, dayBeforeYesterday);
      const videoTwoDaysBeforeYesterday = summarizeTopicVideos(
        videos,
        twoDaysBeforeYesterday,
        twoDaysBeforeYesterday,
      );
      const rankingRange = rankingMode === "today"
        ? { from: today, to: today }
        : rankingMode === "yesterday"
          ? { from: yesterday, to: yesterday }
          : { from, to };
      const value: PeriodReport = {
        period,
        range: { from, to, today, yesterday, dayBefore: dayBeforeYesterday },
        video: {
          cumulative: summarizeTopicVideos(videos, from, to),
          today: withVideoCountDeltas(videoToday, videoYesterday),
          yesterday: withVideoCountDeltas(videoYesterday, videoDayBeforeYesterday),
          dayBefore: withVideoCountDeltas(videoDayBeforeYesterday, videoTwoDaysBeforeYesterday),
          topGrowth: topicTopGrowth(videos, rankingRange.from, rankingRange.to, 5),
          trend: includeTrend ? buildTopicVideoTrend(from, to, videos) : [],
        },
        live: {
          cumulative: emptyLiveSummary(),
          today: emptyLiveSummary(),
          yesterday: emptyLiveSummary(),
          dayBefore: emptyLiveSummary(),
        },
      };
      this.reportCache.set(cacheKey, { value, expiresAt: Date.now() + this.cacheTtlMs });
      return value;
    }

    const dailyVideoRequests = new Map<string, Promise<VideoSummary>>();
    const getDailyVideo = (date: string): Promise<VideoSummary> => {
      if (!videoConfig) return Promise.resolve(emptyVideoSummary());
      const existing = dailyVideoRequests.get(date);
      if (existing) return existing;
      const request = this.client.getVideoSummary(videoConfig.contentConfigId, { date });
      dailyVideoRequests.set(date, request);
      return request;
    };

    const videoCumulativePromise = videoConfig
      ? this.client.getVideoSummary(videoConfig.contentConfigId, { from, to })
      : Promise.resolve(emptyVideoSummary());
    const videoTodayPromise = getDailyVideo(today);
    const videoYesterdayPromise = getDailyVideo(yesterday);
    const videoDayBeforeYesterdayPromise = getDailyVideo(dayBeforeYesterday);
    const videoTwoDaysBeforeYesterdayPromise = getDailyVideo(twoDaysBeforeYesterday);
    const topGrowthPromise = videoConfig
      ? this.client.getTopGrowth(
          videoConfig.contentConfigId,
          rankingMode === "today"
            ? { date: today }
            : rankingMode === "yesterday"
              ? { date: yesterday }
              : { from, to },
          5,
        )
      : Promise.resolve([]);
    const liveCumulativePromise = liveConfig
      ? this.client.getLiveSummary(liveConfig.contentConfigId, { from, to })
      : Promise.resolve(emptyLiveSummary());
    const liveTodayPromise = liveConfig
      ? this.client.getLiveSummary(liveConfig.contentConfigId, { date: today })
      : Promise.resolve(emptyLiveSummary());
    const liveYesterdayPromise = liveConfig
      ? this.client.getLiveSummary(liveConfig.contentConfigId, { date: yesterday })
      : Promise.resolve(emptyLiveSummary());
    const liveDayBeforeYesterdayPromise = liveConfig
      ? this.client.getLiveSummary(liveConfig.contentConfigId, { date: dayBeforeYesterday })
      : Promise.resolve(emptyLiveSummary());
    const videoTrendPromise = includeTrend && videoConfig
      ? buildVideoTrend(from, to, getDailyVideo)
      : Promise.resolve([]);

    const [
      videoCumulative,
      videoToday,
      videoYesterday,
      videoDayBeforeYesterday,
      videoTwoDaysBeforeYesterday,
      topGrowth,
      liveCumulative,
      liveToday,
      liveYesterday,
      liveDayBeforeYesterday,
      videoTrend,
    ] = await Promise.all([
      videoCumulativePromise,
      videoTodayPromise,
      videoYesterdayPromise,
      videoDayBeforeYesterdayPromise,
      videoTwoDaysBeforeYesterdayPromise,
      topGrowthPromise,
      liveCumulativePromise,
      liveTodayPromise,
      liveYesterdayPromise,
      liveDayBeforeYesterdayPromise,
      videoTrendPromise,
    ]);

    const value: PeriodReport = {
      period,
      range: { from, to, today, yesterday, dayBefore: dayBeforeYesterday },
      video: {
        cumulative: videoCumulative,
        today: withVideoCountDeltas(videoToday, videoYesterday),
        yesterday: withVideoCountDeltas(videoYesterday, videoDayBeforeYesterday),
        dayBefore: withVideoCountDeltas(videoDayBeforeYesterday, videoTwoDaysBeforeYesterday),
        topGrowth,
        trend: videoTrend,
      },
      live: {
        cumulative: liveCumulative,
        today: liveToday,
        yesterday: liveYesterday,
        dayBefore: liveDayBeforeYesterday,
      },
    };
    this.reportCache.set(cacheKey, { value, expiresAt: Date.now() + this.cacheTtlMs });
    return value;
  }

  private async getMetadata(force = false): Promise<MetadataCache> {
    if (!force && this.metadataCache && this.metadataCache.expiresAt > Date.now()) {
      return this.metadataCache;
    }
    const [periods, contents] = await Promise.all([this.client.listProjectPeriods(), this.client.listContents()]);
    this.metadataCache = { periods, contents, expiresAt: Date.now() + this.cacheTtlMs };
    return this.metadataCache;
  }

  private compareProjects(a: number, b: number): number {
    const aIndex = this.projectOrder.indexOf(a);
    const bIndex = this.projectOrder.indexOf(b);
    if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
    if (aIndex >= 0) return -1;
    if (bIndex >= 0) return 1;
    return a - b;
  }
}

function summarizeTopicVideos(videos: VideoWithMetrics[], from: string, to: string): VideoSummary {
  let playCount = 0;
  let likeCount = 0;
  let commentCount = 0;
  let contentCount = 0;
  const authors = new Set<string>();

  for (const video of videos) {
    const metrics = video.metrics.filter((metric) => metric.statDate >= from && metric.statDate <= to);
    if (metrics.length === 0) continue;
    contentCount += 1;
    const author = video.authorUid ?? video.authorName;
    if (author) authors.add(author);
    for (const metric of metrics) {
      playCount += metric.playIncrement ?? 0;
      likeCount += metric.likeIncrement ?? 0;
      commentCount += metric.commentIncrement ?? 0;
    }
  }

  return { playCount, likeCount, commentCount, contentCount, authorCount: authors.size };
}

function topicTopGrowth(
  videos: VideoWithMetrics[],
  from: string,
  to: string,
  limit: number,
): VideoGrowth[] {
  return videos
    .flatMap((video): VideoGrowth[] => {
      const metrics = video.metrics
        .filter((metric) => metric.statDate >= from && metric.statDate <= to)
        .sort((a, b) => a.statDate.localeCompare(b.statDate));
      if (metrics.length === 0) return [];
      const playGrowth = metrics.reduce((sum, metric) => sum + (metric.playIncrement ?? 0), 0);
      const latest = metrics.at(-1)!;
      return [{
        contentConfigId: video.contentConfigId,
        videoId: video.videoId,
        publishTime: video.publishTime,
        authorName: video.authorName,
        title: video.title,
        label: video.label,
        playGrowth,
        avgDailyPlayGrowth: playGrowth / metrics.length,
        metricDays: metrics.length,
        latestPlayCount: latest.playCount ?? video.latestPlayCount,
        latestStatDate: latest.statDate,
      }];
    })
    .sort((a, b) => b.playGrowth - a.playGrowth || a.videoId.localeCompare(b.videoId))
    .slice(0, limit);
}

function buildTopicVideoTrend(from: string, to: string, videos: VideoWithMetrics[]): VideoTrendPoint[] {
  const dates = isoDateRange(from, to).slice(-31);
  if (dates.length === 0) return [];
  const summaries = [previousIsoDate(dates[0]!), ...dates].map((date) =>
    summarizeTopicVideos(videos, date, date));
  return dates.map((date, index) => {
    const current = summaries[index + 1]!;
    const previous = summaries[index]!;
    const delta = withVideoCountDeltas(current, previous);
    return {
      date,
      playCount: current.playCount,
      contentCount: delta.contentCount,
      authorCount: delta.authorCount,
    };
  });
}

async function buildVideoTrend(
  from: string,
  to: string,
  getDailyVideo: (date: string) => Promise<VideoSummary>,
): Promise<VideoTrendPoint[]> {
  const dates = isoDateRange(from, to).slice(-31);
  if (dates.length === 0) return [];
  const previousDate = previousIsoDate(dates[0]!);
  const summaries = await Promise.all([previousDate, ...dates].map(getDailyVideo));
  return dates.map((date, index) => {
    const current = summaries[index + 1]!;
    const previous = summaries[index]!;
    const delta = withVideoCountDeltas(current, previous);
    return {
      date,
      playCount: current.playCount,
      contentCount: delta.contentCount,
      authorCount: delta.authorCount,
    };
  });
}

function isoDateRange(from: string, to: string): string[] {
  if (from > to) return [];
  const values: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    values.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return values;
}

export function dateInTimezone(timezone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function previousIsoDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! - 1));
  return date.toISOString().slice(0, 10);
}

function minIsoDate(a: string, b: string): string {
  return a < b ? a : b;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function withVideoCountDeltas(current: VideoSummary, previous: VideoSummary): VideoSummary {
  return {
    ...current,
    contentCount: Math.max(0, current.contentCount - previous.contentCount),
    authorCount: Math.max(0, current.authorCount - previous.authorCount),
  };
}
