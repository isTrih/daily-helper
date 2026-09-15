import type {
  CardColor,
  CardJson,
  CardViewState,
  PeriodReport,
  ProjectColors,
  ProjectIcons,
  ProjectPeriod,
} from "./types.ts";

type CardElement = Record<string, unknown>;

const defaultProjectColors: ProjectColors = {
  1: "yellow",
  2: "purple",
  3: "green",
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

export function buildReportCard(args: {
  reports: PeriodReport[];
  allPeriods: ProjectPeriod[];
  state: CardViewState;
  timezone?: string;
  interactive?: boolean;
  projectColors?: ProjectColors;
  projectIcons?: ProjectIcons;
}): CardJson {
  const { reports, allPeriods, state } = args;
  if (reports.length === 0) throw new Error("日报至少需要包含一个项目期次");

  const timezone = args.timezone ?? "Asia/Shanghai";
  const interactive = args.interactive ?? true;
  const projectColors = args.projectColors ?? {};
  const projectIcons = args.projectIcons ?? {};
  const focusedReport = reports.length === 1 ? reports[0] : undefined;
  const isCombined = state.scope === "combined" && reports.length > 1;
  const theme = focusedReport ? colorFor(focusedReport.period.projectId, projectColors) : "blue";
  const iconKey = focusedReport ? projectIcons[focusedReport.period.projectId] : undefined;
  const title = focusedReport ? focusedReport.period.period : "项目每日速览";
  const subtitle = `统计区间 ${reports[0]!.range.from} — ${reports[0]!.range.to}`;
  const tags = (isCombined ? reports.slice(0, 3) : []).map((report) => ({
    tag: "text_tag",
    text: { tag: "plain_text", content: report.period.projectDisplayName },
    color: colorFor(report.period.projectId, projectColors),
  }));

  const elements: CardElement[] = interactive
    ? [...controls(allPeriods, state), { tag: "hr", margin: "4px 0 8px 0" }]
    : [];

  // 原始卡片 JSON 2.0 不支持模板循环，这里在服务端稳定展开每个项目的 Top 5。
  for (const [index, report] of reports.entries()) {
    if (index > 0) elements.push({ tag: "hr", margin: "12px 0" });
    elements.push(...reportElements(report, state.rankingMode, timezone, isCombined, projectColors));
  }

  elements.push({
    tag: "column_set",
    flex_mode: "none",
    horizontal_align: "right",
    horizontal_spacing: "6px",
    margin: "10px 0 0 0",
    columns: [
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: "<font color='grey'>有疑问找</font>",
              text_size: "notation",
              text_align: "right",
            },
          },
        ],
      },
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: [
          {
            tag: "person",
            element_id: "report_contact",
            size: "extra_small",
            user_id: "ou_c909863fbf86e93840200f4d30a2229c",
            show_avatar: true,
            show_name: true,
            style: "capsule",
          },
        ],
      },
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: `<font color='grey'>卡片更新于 ${formatUpdateTime(timezone)}</font>`,
              text_size: "notation",
            },
          },
        ],
      },
      ...(interactive
        ? [
            {
              tag: "column",
              width: "auto",
              vertical_align: "center",
              elements: [cardToolsButton(state, "full")],
            },
          ]
        : []),
    ],
  });

  return {
    schema: "2.0",
    config: {
      update_multi: interactive,
      enable_forward: false,
      enable_forward_interaction: false,
      summary: { content: `${title}｜${subtitle}` },
      style: cardColorStyle,
    },
    header: {
      template: theme,
      title: { tag: "plain_text", content: title },
      subtitle: { tag: "plain_text", content: subtitle },
      ...(tags.length > 0 ? { text_tag_list: tags } : {}),
      icon: iconKey
        ? { tag: "custom_icon", img_key: iconKey }
        : { tag: "standard_icon", token: "chart-pie_outlined" },
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

export function buildCollapsedReportCard(args: {
  reports: PeriodReport[];
  state: CardViewState;
  timezone?: string;
  projectColors?: ProjectColors;
  projectIcons?: ProjectIcons;
}): CardJson {
  const { reports, state } = args;
  if (reports.length === 0) throw new Error("日报至少需要包含一个项目期次");

  const identity = cardIdentity(reports, args.projectColors ?? {}, args.projectIcons ?? {});
  return {
    schema: "2.0",
    config: interactiveCardConfig(identity.title, identity.subtitle),
    header: cardHeader(identity),
    body: {
      direction: "vertical",
      padding: "10px 12px",
      elements: [
        {
          tag: "column_set",
          flex_mode: "none",
          horizontal_align: "right",
          horizontal_spacing: "8px",
          columns: [
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
                    content: `<font color='grey'>日报已收起 · 更新于 ${formatUpdateTime(args.timezone ?? "Asia/Shanghai")}</font>`,
                    text_size: "notation",
                  },
                },
              ],
            },
            {
              tag: "column",
              width: "auto",
              vertical_align: "center",
              elements: [cardToolsButton(state, "collapsed")],
            },
          ],
        },
      ],
    },
  };
}

export function buildRecallConfirmationCard(args: {
  reports: PeriodReport[];
  state: CardViewState;
  returnView: "full" | "collapsed";
}): CardJson {
  const { reports, state, returnView } = args;
  if (reports.length === 0) throw new Error("日报至少需要包含一个项目期次");

  const title = reports.length === 1 ? reports[0]!.period.period : "项目每日速览";
  const actionState = { ...cardStateValue(state), return_view: returnView };
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      enable_forward: false,
      enable_forward_interaction: false,
      summary: { content: `确认撤回 ${title}` },
    },
    header: {
      template: "red",
      title: { tag: "plain_text", content: "撤回确认" },
      subtitle: { tag: "plain_text", content: title },
      icon: { tag: "standard_icon", token: "warning_outlined" },
      padding: "12px",
    },
    body: {
      direction: "vertical",
      padding: "12px",
      vertical_spacing: "10px",
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: "**确认撤回这条日报卡片？**\n<font color='grey'>撤回后将从当前会话中移除，且无法恢复。</font>",
          },
        },
        {
          tag: "column_set",
          flex_mode: "bisect",
          horizontal_spacing: "8px",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [button("取消撤回", "cancel_recall", { action: "cancel_recall", ...actionState })],
            },
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [button("确认撤回", "confirm_recall", { action: "confirm_recall", ...actionState }, false, "danger")],
            },
          ],
        },
      ],
    },
  };
}

export function buildCardToolsCard(args: {
  reports: PeriodReport[];
  state: CardViewState;
  returnView: "full" | "collapsed";
  projectColors?: ProjectColors;
  projectIcons?: ProjectIcons;
}): CardJson {
  const { reports, state, returnView } = args;
  if (reports.length === 0) throw new Error("日报至少需要包含一个项目期次");

  const identity = cardIdentity(reports, args.projectColors ?? {}, args.projectIcons ?? {});
  const actionState = { ...cardStateValue(state), return_view: returnView };
  return {
    schema: "2.0",
    config: interactiveCardConfig(identity.title, identity.subtitle),
    header: {
      ...cardHeader(identity),
      title: { tag: "plain_text", content: "卡片管理" },
    },
    body: {
      direction: "vertical",
      padding: "12px",
      elements: [
        {
          tag: "column_set",
          flex_mode: "trisect",
          horizontal_spacing: "8px",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                button(
                  returnView === "full" ? "收起卡片" : "展开卡片",
                  returnView === "full" ? "collapse_card" : "expand_card",
                  {
                    action: returnView === "full" ? "collapse_card" : "expand_card",
                    ...actionState,
                  },
                ),
              ],
            },
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                button("撤回卡片", "request_recall", { action: "request_recall", ...actionState }, false, "danger"),
              ],
            },
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                button("返回日报", "cancel_card_tools", { action: "cancel_card_tools", ...actionState }),
              ],
            },
          ],
        },
      ],
    },
  };
}

function cardIdentity(
  reports: PeriodReport[],
  projectColors: ProjectColors,
  projectIcons: ProjectIcons,
): {
  title: string;
  subtitle: string;
  theme: CardColor;
  iconKey?: string;
} {
  const focusedReport = reports.length === 1 ? reports[0] : undefined;
  return {
    title: focusedReport ? focusedReport.period.period : "项目每日速览",
    subtitle: `统计区间 ${reports[0]!.range.from} — ${reports[0]!.range.to}`,
    theme: focusedReport ? colorFor(focusedReport.period.projectId, projectColors) : "blue",
    ...(focusedReport && projectIcons[focusedReport.period.projectId]
      ? { iconKey: projectIcons[focusedReport.period.projectId] }
      : {}),
  };
}

function interactiveCardConfig(title: string, subtitle: string): Record<string, unknown> {
  return {
    update_multi: true,
    enable_forward: false,
    enable_forward_interaction: false,
    summary: { content: `${title}｜${subtitle}` },
    style: cardColorStyle,
  };
}

function cardHeader(identity: ReturnType<typeof cardIdentity>): Record<string, unknown> {
  return {
    template: identity.theme,
    title: { tag: "plain_text", content: identity.title },
    subtitle: { tag: "plain_text", content: identity.subtitle },
    icon: identity.iconKey
      ? { tag: "custom_icon", img_key: identity.iconKey }
      : { tag: "standard_icon", token: "chart-pie_outlined" },
    padding: "12px",
  };
}

function cardToolsButton(state: CardViewState, view: "full" | "collapsed"): CardElement {
  return {
    tag: "button",
    element_id: view === "full" ? "card_tools" : "collapsed_tools",
    type: "default",
    size: "small",
    text: { tag: "plain_text", content: "管理" },
    behaviors: [
      {
        type: "callback",
        value: {
          action: "open_card_tools",
          ...cardStateValue(state),
          return_view: view,
        },
      },
    ],
  };
}

function cardStateValue(state: CardViewState): Record<string, string> {
  return {
    ranking_mode: state.rankingMode,
    scope: state.scope,
    period_ids: state.periodIds.join(","),
    selected_period_id: state.selectedPeriodId ? String(state.selectedPeriodId) : "",
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
        ...(availablePeriods.length <= 4
          ? [
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
            ]
          : []),
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
  type?: "default" | "primary" | "danger",
): CardElement {
  return {
    tag: "button",
    element_id: elementId,
    type: type ?? (active ? "primary" : "default"),
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
  showHeading: boolean,
  projectColors: ProjectColors,
): CardElement[] {
  const { period, video, live } = report;
  const hasLiveData = hasCumulativeLiveData(live.cumulative);
  const color = colorFor(period.projectId, projectColors);
  const heading = `<text_tag color='${color}'>${safeMarkdownText(period.projectDisplayName)}</text_tag> **${safeMarkdownText(period.period)}**`;
  const headingElements: CardElement[] = showHeading
    ? [{ tag: "div", text: { tag: "lark_md", content: heading, text_size: "heading" } }]
    : [];
  const dailyMetricColumns: CardElement[] = [
    highlightMetric(
      "▶ 今日视频播放",
      video.today.playCount,
      `新增稿件 ${formatNumber(video.today.contentCount)}丨参与作者 ${formatNumber(video.today.authorCount)}`,
      metricTones.video,
      true,
    ),
    highlightMetric(
      "昨日视频播放",
      video.yesterday.playCount,
      `新增稿件 ${formatNumber(video.yesterday.contentCount)}丨参与作者 ${formatNumber(video.yesterday.authorCount)}`,
      metricTones.content,
      true,
    ),
    ...(hasLiveData
      ? [
          highlightMetric(
            "◉ 今日开播",
            `${formatNumber(live.today.liveSessionCount)} 场`,
            `参与主播 ${formatNumber(live.today.anchorCount)}`,
            metricTones.live,
          ),
          highlightMetric(
            "昨日开播",
            `${formatNumber(live.yesterday.liveSessionCount)} 场`,
            `参与主播 ${formatNumber(live.yesterday.anchorCount)}`,
            metricTones.activity,
          ),
        ]
      : []),
  ];
  const dailyMetrics: CardElement[] = [
    {
      tag: "column_set",
      flex_mode: hasLiveData ? "flow" : "bisect",
      horizontal_spacing: "6px",
      margin: "2px 0",
      columns: dailyMetricColumns,
    },
  ];
  const cumulativeMetrics: CardElement[] = [
    summaryMetric("本期播放", video.cumulative.playCount, metricTones.video),
    summaryMetric(
      "稿件 / 作者",
      `${formatNumber(video.cumulative.contentCount)} / ${formatNumber(video.cumulative.authorCount)}`,
      metricTones.content,
    ),
    ...(hasLiveData
      ? [
          summaryMetric("直播PV", live.cumulative.liveExposurePv, metricTones.live),
          summaryMetric(
            "场次 / 主播",
            `${formatNumber(live.cumulative.liveSessionCount)} / ${formatNumber(live.cumulative.anchorCount)}`,
            metricTones.activity,
          ),
        ]
      : []),
  ];
  if (showHeading) {
    return [
      ...headingElements,
      ...dailyMetrics,
      {
        tag: "div",
        margin: "2px 0 6px 0",
        text: {
          tag: "lark_md",
          content: `**本期累计**　播放 ${formatNumber(video.cumulative.playCount)}　·　稿件 ${formatNumber(video.cumulative.contentCount)}　·　作者 ${formatNumber(video.cumulative.authorCount)}${hasLiveData ? `\n直播PV ${formatNumber(live.cumulative.liveExposurePv)}　·　场次 ${formatNumber(live.cumulative.liveSessionCount)}　·　主播 ${formatNumber(live.cumulative.anchorCount)}` : ""}`,
          text_size: "notation",
        },
      },
      compactTopGrowthElement(video.topGrowth, timezone, rankingMode),
    ];
  }

  return [
    ...headingElements,
    ...dailyMetrics,
    {
      tag: "column_set",
      flex_mode: "bisect",
      horizontal_spacing: "6px",
      margin: "2px 0",
      columns: cumulativeMetrics,
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
    const title = truncateTitle(item.title || `视频 ${item.videoId}`);
    const label = auditLabel(item.label);
    const videoUrl = `https://www.douyin.com/video/${encodeURIComponent(item.videoId)}`;
    const publishedAt = formatPublishTime(item.publishTime, timezone);
    const cumulative = item.latestPlayCount === null ? "" : `丨累计播放 ${formatNumber(item.latestPlayCount)}`;
    return `${medals[index] ?? String(index + 1)} [${safeLinkText(title)}](${videoUrl})${label}　**+${formatNumber(item.playGrowth)}**\n<font color='grey'>${safeMarkdownText(item.authorName || "未知作者")}丨发布 ${publishedAt}${cumulative}丨${growthLabel}</font>`;
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

function hasCumulativeLiveData(summary: PeriodReport["live"]["cumulative"]): boolean {
  return summary.liveExposurePv !== 0 ||
    summary.liveSessionCount !== 0 ||
    summary.anchorCount !== 0 ||
    summary.avgAcu !== null;
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
    const title = truncateTitle(item.title || `视频 ${item.videoId}`);
    const label = auditLabel(item.label);
    const videoUrl = `https://www.douyin.com/video/${encodeURIComponent(item.videoId)}`;
    const publishedAt = formatPublishTime(item.publishTime, timezone);
    const latest = item.latestPlayCount === null ? "" : `丨累计播放 ${formatNumber(item.latestPlayCount)}`;
    const meta = `${item.authorName || "未知作者"}丨发布 ${publishedAt}${latest}`;
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
                content: `${medals[index] ?? String(index + 1)} [${safeLinkText(title)}](${videoUrl})${label}\n<font color='grey'>${safeMarkdownText(meta)}</font>`,
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

function colorFor(projectId: number, projectColors: ProjectColors): CardColor {
  return projectColors[projectId] ?? defaultProjectColors[projectId] ?? "blue";
}

function periodOptionText(period: ProjectPeriod): string {
  return `${period.projectDisplayName} · ${period.period}`;
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)}w`;
  return String(Math.round(value * 10) / 10);
}

function truncateTitle(value: string): string {
  const characters = Array.from(value);
  if (characters.length <= 12) return value;
  return `${characters.slice(0, 12).join("")}…`;
}

function auditLabel(value: string | null): string {
  const label = value?.trim();
  return label ? `　<text_tag color='neutral'>${safeMarkdownText(label)}</text_tag>` : "";
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

function formatUpdateTime(timezone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}
