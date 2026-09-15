export type RankingMode = "today" | "yesterday" | "period";
export type ReportMode = "combined" | "single";
export type CardColor =
  | "blue"
  | "wathet"
  | "turquoise"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "carmine"
  | "violet"
  | "purple"
  | "indigo"
  | "grey";
export type ProjectColors = Record<number, CardColor>;
export type ProjectIcons = Record<number, string>;

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

export interface VideoTrendPoint {
  date: string;
  playCount: number;
  contentCount: number;
  authorCount: number;
}

export interface PeriodReport {
  period: ProjectPeriod;
  range: { from: string; to: string; today: string; yesterday: string; dayBefore: string };
  video: {
    cumulative: VideoSummary;
    today: VideoSummary;
    yesterday: VideoSummary;
    dayBefore: VideoSummary;
    topGrowth: VideoGrowth[];
    trend: VideoTrendPoint[];
  };
  live: {
    cumulative: LiveSummary;
    today: LiveSummary;
    yesterday: LiveSummary;
    dayBefore: LiveSummary;
  };
}

export interface CardViewState {
  scope: "combined" | "period";
  periodIds: number[];
  selectedPeriodId?: number;
  rankingMode: RankingMode;
  enableForward?: boolean;
  enableForwardInteraction?: boolean;
  showTrend?: boolean;
  controlsMode?: "full" | "tools";
  interactiveExpiresAt?: string;
}

export type CardJson = Record<string, unknown>;

export interface ChatOption {
  chatId: string;
  name: string;
  avatar?: string;
  description?: string;
}
