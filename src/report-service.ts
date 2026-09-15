import type { PeriodReport, ProjectPeriod, RankingMode } from "./types.ts";
import { emptyLiveSummary, emptyVideoSummary, XingtuClient } from "./xingtu-client.ts";

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
    const allowed = projectIds ? new Set(projectIds) : undefined;
    return periods
      .filter((period) => period.isLatest && (!allowed || allowed.has(period.projectId)))
      .sort((a, b) => this.compareProjects(a.projectId, b.projectId));
  }

  async buildReports(periodIds: number[], rankingMode: RankingMode): Promise<PeriodReport[]> {
    const metadata = await this.getMetadata();
    const uniqueIds = [...new Set(periodIds)];
    const byId = new Map(metadata.periods.map((period) => [period.activityPeriodId, period]));
    const unknownIds = uniqueIds.filter((id) => !byId.has(id));
    if (unknownIds.length > 0) {
      throw new Error(`找不到活动期次：${unknownIds.join(", ")}`);
    }

    const reports = await Promise.all(
      uniqueIds.map((id) => this.buildPeriodReport(byId.get(id)!, metadata.contents, rankingMode)),
    );
    return reports.sort((a, b) => this.compareProjects(a.period.projectId, b.period.projectId));
  }

  private async buildPeriodReport(
    period: ProjectPeriod,
    contents: MetadataCache["contents"],
    rankingMode: RankingMode,
  ): Promise<PeriodReport> {
    const cacheKey = `${period.activityPeriodId}:${rankingMode}:${dateInTimezone(this.timezone)}`;
    const cached = this.reportCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const today = dateInTimezone(this.timezone);
    const yesterday = previousIsoDate(today);
    const from = period.trackingStartDate ?? period.taskMonth ?? today;
    const configuredEnd = period.trackingEndDate ?? today;
    const to = today < from ? from : minIsoDate(today, configuredEnd);
    const videoConfig = contents.find(
      (item) => item.activityPeriodId === period.activityPeriodId && item.contentType === "video",
    );
    const liveConfig = contents.find(
      (item) => item.activityPeriodId === period.activityPeriodId && item.contentType === "live",
    );

    const videoCumulativePromise = videoConfig
      ? this.client.getVideoSummary(videoConfig.contentConfigId, { from, to })
      : Promise.resolve(emptyVideoSummary());
    const videoTodayPromise = videoConfig
      ? this.client.getVideoSummary(videoConfig.contentConfigId, { date: today })
      : Promise.resolve(emptyVideoSummary());
    const videoYesterdayPromise = videoConfig
      ? this.client.getVideoSummary(videoConfig.contentConfigId, { date: yesterday })
      : Promise.resolve(emptyVideoSummary());
    const topGrowthPromise = videoConfig
      ? this.client.getTopGrowth(
          videoConfig.contentConfigId,
          rankingMode === "today" ? { date: today } : { from, to },
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

    const [
      videoCumulative,
      videoToday,
      videoYesterday,
      topGrowth,
      liveCumulative,
      liveToday,
      liveYesterday,
    ] = await Promise.all([
      videoCumulativePromise,
      videoTodayPromise,
      videoYesterdayPromise,
      topGrowthPromise,
      liveCumulativePromise,
      liveTodayPromise,
      liveYesterdayPromise,
    ]);

    const value: PeriodReport = {
      period,
      range: { from, to, today, yesterday },
      video: { cumulative: videoCumulative, today: videoToday, yesterday: videoYesterday, topGrowth },
      live: { cumulative: liveCumulative, today: liveToday, yesterday: liveYesterday },
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
