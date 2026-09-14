export type RankingMode = "today" | "period";
export type ReportMode = "combined" | "single";

export interface ProjectPeriod {
  activityPeriodId: number;
  projectId: number;
  projectKey: string;
  projectDisplayName: string;
  period: string;
  periodCode?: string;
  taskMonth?: string;
  trackingStartDate?: string;
  trackingEndDate?: string;
  isLatest: boolean;
}

export interface ContentConfig {
  contentConfigId: number;
  activityPeriodId: number;
  contentType: "video" | "live";
}

export interface VideoSummary {
  playCount: number;
  likeCount: number;
  commentCount: number;
  contentCount: number;
  authorCount: number;
}

export interface LiveSummary {
  liveExposurePv: number;
  avgAcu: number | null;
  liveSessionCount: number;
  anchorCount: number;
}

export interface VideoGrowth {
  contentConfigId: number;
  videoId: string;
  publishTime: string;
  authorName: string | null;
  title: string | null;
  label: string | null;
  playGrowth: number;
  avgDailyPlayGrowth: number | null;
  metricDays: number;
  latestPlayCount: number | null;
  latestStatDate: string | null;
}

export interface PeriodReport {
  period: ProjectPeriod;
  range: { from: string; to: string; today: string };
  video: {
    cumulative: VideoSummary;
    today: VideoSummary;
    topGrowth: VideoGrowth[];
  };
  live: {
    cumulative: LiveSummary;
    today: LiveSummary;
  };
}

export interface CardViewState {
  scope: "combined" | "period";
  periodIds: number[];
  selectedPeriodId?: number;
  rankingMode: RankingMode;
}

export type CardJson = Record<string, unknown>;

export interface ChatOption {
  chatId: string;
  name: string;
  avatar?: string;
  description?: string;
}
