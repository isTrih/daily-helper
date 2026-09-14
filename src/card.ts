import type { CardJson, CardViewState, PeriodReport, ProjectPeriod } from "./types.ts";

type CardElement = Record<string, unknown>;
type Theme = "blue" | "yellow" | "purple" | "green";

const projectStyle: Record<number, { theme: Theme; tag: string }> = {
  1: { theme: "yellow", tag: "yellow" },
  2: { theme: "purple", tag: "purple" },
  3: { theme: "green", tag: "green" },
};

const metricTones = {
  video: {
    background: "cus-0",
    border: "blue-100",
    text: "blue",
  },
  live: {
    background: "cus-1",
    border: "green-100",
    text: "green",
  },
  content: {
    background: "cus-2",
    border: "purple-100",
    text: "purple",
  },
  activity: {
    background: "cus-3",
    border: "orange-100",
    text: "orange",
  },
} as const;

const cardColorStyle = {
  color: {
    "cus-0": {
      light_mode: "rgba(240,246,255,0.88)",
      dark_mode: "rgba(25,38,60,0.88)",
    },
    "cus-1": {
      light_mode: "rgba(239,251,246,0.90)",
      dark_mode: "rgba(22,51,40,0.88)",
    },
    "cus-2": {
      light_mode: "rgba(248,244,255,0.90)",
      dark_mode: "rgba(43,31,64,0.88)",
    },
    "cus-3": {
      light_mode: "rgba(255,247,239,0.92)",
      dark_mode: "rgba(58,40,25,0.88)",
    },
  },
};

const numberFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

export function buildReportCard(args: {
  reports: PeriodReport[];
  allPeriods: ProjectPeriod[];
  state: CardViewState;
  timezone?: string;
}): CardJson {
  const { reports, allPeriods, state } = args;
  if (reports.length === 0) throw new Error("日报至少需要包含一个项目期次");

  const timezone = args.timezone ?? "Asia/Shanghai";
  const focusedReport = reports.length === 1 ? reports[0] : undefined;
  const theme = focusedReport ? styleFor(focusedReport.period.projectId).theme : "blue";
  const title = focusedReport ? focusedReport.period.period : "项目每日速览";
  const subtitle = `${reports[0]!.range.today} · 今日增长与本期进度`;
  const tags = reports.slice(0, 3).map((report) => ({
    tag: "text_tag",
    text: { tag: "plain_text", content: report.period.projectDisplayName },
    color: styleFor(report.period.projectId).tag,
  }));

  const elements: CardElement[] = [
    ...controls(allPeriods, state),
    { tag: "hr", margin: "4px 0 8px 0" },
  ];

  // 原始卡片 JSON 2.0 不支持模板循环，这里在服务端稳定展开每个项目的 Top 5。
  for (const [index, report] of reports.entries()) {
    if (index > 0) elements.push({ tag: "hr", margin: "12px 0" });
    elements.push(...reportElements(report, state.rankingMode, timezone, reports.length > 1));
  }

  elements.push({
    tag: "div",
    margin: "10px 0 0 0",
    text: {
      tag: "lark_md",
      content: `<font color='grey'>更新于 ${formatTimestamp(timezone)}</font>`,
      text_size: "notation",
      text_align: "right",
    },
  });

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      enable_forward: true,
      enable_forward_interaction: false,
      width_mode: "fill",
      summary: { content: `${title}｜${subtitle}` },
      style: cardColorStyle,
    },
    header: {
      template: theme,
      title: { tag: "plain_text", content: title },
      subtitle: { tag: "plain_text", content: subtitle },
      text_tag_list: tags,
      icon: { tag: "standard_icon", token: "chart-pie_outlined" },
      padding: "12px",
    },
    body: {
      direction: "vertical",
      padding: "12px",
      vertical_spacing: "8px",
      elements,
    },
  };
}

function controls(allPeriods: ProjectPeriod[], state: CardViewState): CardElement[] {
  const availablePeriods = latestPeriodPerProject(allPeriods);
  const selected = state.selectedPeriodId
    ? availablePeriods.find((period) => period.activityPeriodId === state.selectedPeriodId)
    : undefined;
  const actionState = {
    scope: state.scope,
    period_ids: state.periodIds.join(","),
    selected_period_id: state.selectedPeriodId ? String(state.selectedPeriodId) : "",
  };

  return [
    {
      tag: "column_set",
      flex_mode: "flow",
      background_style: "grey",
      horizontal_spacing: "8px",
      margin: "0",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 3,
          padding: "8px 0 8px 8px",
          elements: [
            {
              tag: "select_static",
              element_id: "period_picker",
              name: "period_picker",
              type: "default",
              width: "fill",
              placeholder: { tag: "plain_text", content: "切换项目" },
              ...(selected ? { initial_option: periodOptionText(selected) } : {}),
              options: availablePeriods.map((period) => ({
                text: { tag: "plain_text", content: periodOptionText(period) },
                value: String(period.activityPeriodId),
              })),
              behaviors: [
                {
                  type: "callback",
                  value: {
                    action: "select_period",
                    ranking_mode: state.rankingMode,
                    period_ids: state.periodIds.join(","),
                  },
                },
              ],
            },
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          padding: "8px 0",
          elements: [
            button("所有项目", "view_latest", {
              action: "show_latest",
              ranking_mode: state.rankingMode,
            }),
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          padding: "8px 0",
          elements: [
            button("今日增长", "rank_today", {
              action: "set_ranking",
              ranking_mode: "today",
              ...actionState,
            }, state.rankingMode === "today"),
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          padding: "8px 8px 8px 0",
          elements: [
            button("本期增长", "rank_period", {
              action: "set_ranking",
              ranking_mode: "period",
              ...actionState,
            }, state.rankingMode === "period"),
          ],
        },
      ],
    },
  ];
}

function button(
  label: string,
  elementId: string,
  value: Record<string, string>,
  active = false,
): CardElement {
  return {
    tag: "button",
    element_id: elementId,
    type: active ? "primary" : "default",
    size: "small",
    width: "fill",
    text: { tag: "plain_text", content: label },
    behaviors: [{ type: "callback", value }],
  };
}

function reportElements(
  report: PeriodReport,
  rankingMode: CardViewState["rankingMode"],
  timezone: string,
  compact: boolean,
): CardElement[] {
  const { period, range, video, live } = report;
  const style = styleFor(period.projectId);
  const heading = `<text_tag color='${style.tag}'>${safeMarkdownText(period.projectDisplayName)}</text_tag> **${safeMarkdownText(period.period)}**`;
  const headingElements: CardElement[] = [
    {
      tag: "div",
      text: { tag: "lark_md", content: heading, text_size: "heading" },
    },
    {
      tag: "div",
      margin: "0 0 2px 0",
      text: {
        tag: "lark_md",
        content: `<font color='grey'>统计区间 ${range.from} — ${range.to}</font>`,
        text_size: "notation",
      },
    },
  ];
  const todayMetrics: CardElement = {
    tag: "column_set",
    flex_mode: "bisect",
    horizontal_spacing: "8px",
    margin: "2px 0 2px 0",
    columns: [
      highlightMetric(
        "▶ 今日播放新增",
        video.today.playCount,
        `今日稿件 ${formatNumber(video.today.contentCount)} · 作者 ${formatNumber(video.today.authorCount)}`,
        metricTones.video,
        true,
      ),
      highlightMetric(
        "◉ 今日直播",
        `${formatNumber(live.today.liveSessionCount)} 场`,
        `${formatNumber(live.today.anchorCount)} 位主播`,
        metricTones.live,
      ),
    ],
  };

  if (compact) {
    return [
      ...headingElements,
      todayMetrics,
      {
        tag: "div",
        margin: "2px 0 6px 0",
        text: {
          tag: "lark_md",
          content: `**本期累计**　播放 ${formatNumber(video.cumulative.playCount)}　·　稿件 ${formatNumber(video.cumulative.contentCount)}　·　作者 ${formatNumber(video.cumulative.authorCount)}\n直播曝光 ${formatNumber(live.cumulative.liveExposurePv)}　·　场次 ${formatNumber(live.cumulative.liveSessionCount)}　·　主播 ${formatNumber(live.cumulative.anchorCount)}`,
          text_size: "notation",
        },
      },
      compactTopGrowthElement(video.topGrowth, timezone, rankingMode),
    ];
  }

  return [
    ...headingElements,
    todayMetrics,
    {
      tag: "column_set",
      flex_mode: "bisect",
      horizontal_spacing: "6px",
      margin: "2px 0",
      columns: [
        summaryMetric("本期播放", video.cumulative.playCount, metricTones.video),
        summaryMetric(
          "稿件 / 作者",
          `${formatNumber(video.cumulative.contentCount)} / ${formatNumber(video.cumulative.authorCount)}`,
          metricTones.content,
        ),
        summaryMetric("直播曝光", live.cumulative.liveExposurePv, metricTones.live),
        summaryMetric(
          "场次 / 主播",
          `${formatNumber(live.cumulative.liveSessionCount)} / ${formatNumber(live.cumulative.anchorCount)}`,
          metricTones.activity,
        ),
      ],
    },
    {
      tag: "div",
      margin: "2px 0 8px 0",
      text: {
        tag: "lark_md",
        content: `<font color='grey'>点赞 ${formatNumber(video.cumulative.likeCount)}　·　评论 ${formatNumber(video.cumulative.commentCount)}　·　平均 ACU ${live.cumulative.avgAcu === null ? "—" : formatNumber(live.cumulative.avgAcu)}</font>`,
        text_size: "notation",
      },
    },
    {
      tag: "div",
      margin: "4px 0 2px 0",
      text: {
        tag: "lark_md",
        content: `**${rankingMode === "today" ? "今日增长" : "本期增长"} · 视频播放 Top 5**`,
      },
    },
    ...topGrowthElements(video.topGrowth, timezone, rankingMode),
  ];
}

function highlightMetric(
  label: string,
  value: number | string,
  detail: string,
  tone: { background: string; border: string; text: string },
  showPlus = false,
): CardElement {
  const shown = typeof value === "number" ? formatNumber(value) : value;
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    elements: [
      {
        tag: "interactive_container",
        width: "fill",
        height: "82px",
        direction: "vertical",
        background_style: tone.background,
        has_border: true,
        border_color: tone.border,
        corner_radius: "12px",
        padding: "10px 12px",
        behaviors: [],
        elements: [
          {
            tag: "markdown",
            content: `<font color='grey'>${label}</font>\n<font color='${tone.text}'>**${showPlus ? "+" : ""}${shown}**</font>\n<font color='grey'>${detail}</font>`,
            text_size: "notation",
          },
        ],
      },
    ],
  };
}

function compactTopGrowthElement(
  items: PeriodReport["video"]["topGrowth"],
  timezone: string,
  rankingMode: CardViewState["rankingMode"],
): CardElement {
  const growthLabel = rankingMode === "today" ? "今日新增" : "本期新增";
  if (items.length === 0) {
    return {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${rankingMode === "today" ? "今日增长" : "本期增长"} · 视频播放 Top 5**\n<font color='grey'>暂无播放增长数据</font>`,
      },
    };
  }

  const medals = ["🥇", "🥈", "🥉", "④", "⑤"];
  const rows = items.slice(0, 5).map((item, index) => {
    const title = middleTruncate(item.title || `视频 ${item.videoId}`, 10, 10);
    const videoUrl = `https://www.douyin.com/video/${encodeURIComponent(item.videoId)}`;
    const publishedAt = formatPublishTime(item.publishTime, timezone);
    const cumulative = item.latestPlayCount === null ? "" : `　·　累计播放 ${formatNumber(item.latestPlayCount)}`;
    return `${medals[index] ?? String(index + 1)} [${safeLinkText(title)}](${videoUrl})　**+${formatNumber(item.playGrowth)}**\n<font color='grey'>${safeMarkdownText(item.authorName || "未知作者")}　·　发布 ${publishedAt}${cumulative}　·　${growthLabel}</font>`;
  });

  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**${rankingMode === "today" ? "今日增长" : "本期增长"} · 视频播放 Top 5**\n${rows.join("\n")}`,
    },
  };
}

function summaryMetric(
  label: string,
  value: number | string,
  tone: { background: string; border: string; text: string },
): CardElement {
  const shown = typeof value === "number" ? formatNumber(value) : value;
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    elements: [
      {
        tag: "interactive_container",
        width: "fill",
        height: "62px",
        direction: "vertical",
        vertical_align: "center",
        background_style: tone.background,
        has_border: true,
        border_color: tone.border,
        corner_radius: "10px",
        padding: "8px 4px",
        behaviors: [],
        elements: [
          {
            tag: "markdown",
            content: `<font color='${tone.text}'>**${shown}**</font>\n<font color='grey'>${label}</font>`,
            text_size: "notation",
            text_align: "center",
          },
        ],
      },
    ],
  };
}

function topGrowthElements(
  items: PeriodReport["video"]["topGrowth"],
  timezone: string,
  rankingMode: CardViewState["rankingMode"],
): CardElement[] {
  if (items.length === 0) {
    return [
      {
        tag: "div",
        text: { tag: "plain_text", content: "暂无播放增长数据", text_color: "grey" },
      },
    ];
  }

  const medals = ["🥇", "🥈", "🥉", "④", "⑤"];
  return items.slice(0, 5).map((item, index) => {
    const title = middleTruncate(item.title || `视频 ${item.videoId}`, 10, 10);
    const videoUrl = `https://www.douyin.com/video/${encodeURIComponent(item.videoId)}`;
    const publishedAt = formatPublishTime(item.publishTime, timezone);
    const latest = item.latestPlayCount === null ? "" : `　·　累计播放 ${formatNumber(item.latestPlayCount)}`;
    const meta = `${item.authorName || "未知作者"}　·　发布 ${publishedAt}${latest}`;
    const growthLabel = rankingMode === "today" ? "今日新增" : "本期新增";
    return {
      tag: "column_set",
      flex_mode: "none",
      horizontal_spacing: "8px",
      margin: "0",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 4,
          elements: [
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content: `${medals[index] ?? String(index + 1)} [${safeLinkText(title)}](${videoUrl})\n<font color='grey'>${safeMarkdownText(meta)}</font>`,
              },
            },
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          vertical_align: "center",
          elements: [
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content: `**+${formatNumber(item.playGrowth)}**\n<font color='grey'>${growthLabel}</font>`,
                text_align: "right",
              },
            },
          ],
        },
      ],
    };
  });
}

function latestPeriodPerProject(periods: ProjectPeriod[]): ProjectPeriod[] {
  const latestByProject = new Map<number, ProjectPeriod>();
  for (const period of periods) {
    const current = latestByProject.get(period.projectId);
    if (!current || period.activityPeriodId > current.activityPeriodId) {
      latestByProject.set(period.projectId, period);
    }
  }
  return periods.filter((period) => latestByProject.get(period.projectId)?.activityPeriodId === period.activityPeriodId);
}

function styleFor(projectId: number): { theme: Theme; tag: string } {
  return projectStyle[projectId] ?? { theme: "blue", tag: "blue" };
}

function periodOptionText(period: ProjectPeriod): string {
  return `${period.projectDisplayName} · ${period.period}`;
}

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

function middleTruncate(value: string, headLength: number, tailLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= headLength + tailLength) return value;
  return `${characters.slice(0, headLength).join("")}…${characters.slice(-tailLength).join("")}`;
}

// 卡片 Markdown 会把反斜杠原样展示在 text_tag 中，因此用全角字符消除语法含义。
function safeMarkdownText(value: string): string {
  return value
    .replaceAll("\\", "＼")
    .replaceAll("<", "＜")
    .replaceAll(">", "＞")
    .replaceAll("*", "＊")
    .replaceAll("_", "＿")
    .replaceAll("`", "｀")
    .replaceAll("|", "｜");
}

function safeLinkText(value: string): string {
  return safeMarkdownText(value)
    .replaceAll("[", "［")
    .replaceAll("]", "］")
    .replaceAll("(", "（")
    .replaceAll(")", "）");
}

function formatPublishTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeMarkdownText(value || "未知");
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatTimestamp(timezone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}
