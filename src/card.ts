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

const chartPalettes: Record<CardColor, { play: string; fill: string; content: string; author: string }> = {
  blue: { play: "#3370FF", fill: "#D6E4FF", content: "#85A9FF", author: "#1456F0" },
  wathet: { play: "#5B8FF9", fill: "#DCE8FF", content: "#A8C5FF", author: "#2E63C6" },
  turquoise: { play: "#14C2B8", fill: "#D5F5F2", content: "#6FE1D8", author: "#078F88" },
  green: { play: "#34C759", fill: "#DCF6E2", content: "#8DE5A1", author: "#1F8F3E" },
  yellow: { play: "#F5B400", fill: "#FFF1BE", content: "#FFD35C", author: "#C98700" },
  orange: { play: "#F97316", fill: "#FFE4D2", content: "#FDBA74", author: "#C2410C" },
  red: { play: "#F54A45", fill: "#FFE0DF", content: "#FF9B98", author: "#C92B27" },
  carmine: { play: "#E93D82", fill: "#FCE0EB", content: "#F59ABB", author: "#B51F5C" },
  violet: { play: "#8B5CF6", fill: "#EDE7FF", content: "#C4B5FD", author: "#6638CC" },
  purple: { play: "#7C3AED", fill: "#E9DEFF", content: "#BFA4FF", author: "#5521B5" },
  indigo: { play: "#4F46E5", fill: "#E2E2FF", content: "#A5B4FC", author: "#312E9F" },
  grey: { play: "#64748B", fill: "#E7ECF2", content: "#A8B3C2", author: "#334155" },
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
  controlsMode?: "full" | "tools" | "none";
  projectColors?: ProjectColors;
  projectIcons?: ProjectIcons;
}): CardJson {
  const { reports, allPeriods, state } = args;
  if (reports.length === 0) throw new Error("日报至少需要包含一个项目期次");

  const timezone = args.timezone ?? "Asia/Shanghai";
  const controlsMode = args.controlsMode ?? (args.interactive === false ? "none" : "full");
  const interactive = controlsMode !== "none";
  const projectColors = args.projectColors ?? {};
  const projectIcons = args.projectIcons ?? {};
  const focusedReport = reports.length === 1 ? reports[0] : undefined;
  const identity = cardIdentity(reports, projectColors, projectIcons, state.topicKeyword);
  const isCombined = state.scope === "combined" && reports.length > 1;
  const { theme, iconKey, title, subtitle } = identity;
  const tagReports = [...new Map(reports.map((report) => [report.period.projectId, report])).values()];
  const projectTags = (isCombined && tagReports.length > 1 ? tagReports.slice(0, state.topicKeyword ? 2 : 3) : []).map((report) => ({
    tag: "text_tag",
    text: { tag: "plain_text", content: report.period.projectDisplayName },
    color: colorFor(report.period.projectId, projectColors),
  }));
  const tags = [
    ...(state.topicKeyword
      ? [{
          tag: "text_tag",
          text: { tag: "plain_text", content: `#${state.topicKeyword}` },
          color: theme,
        }]
      : []),
    ...projectTags,
  ];

  const elements: CardElement[] = controlsMode === "full"
    ? [...controls(allPeriods, state, timezone), { tag: "hr", margin: "4px 0 8px 0" }]
    : [];

  // 原始卡片 JSON 2.0 不支持模板循环，这里在服务端稳定展开每个项目的 Top 5。
  for (const [index, report] of reports.entries()) {
    if (index > 0) elements.push({ tag: "hr", margin: "12px 0" });
    elements.push(...reportElements(
      report,
      state.rankingMode,
      timezone,
      state.reportDate,
      isCombined,
      projectColors,
      state.showTrend === true && reports.length === 1,
    ));
  }

  const dashboardReport = focusedReport ?? reports[0]!;
  elements.push({
    tag: "column_set",
    flex_mode: "none",
    horizontal_spacing: "6px",
    margin: "10px 0 0 0",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        elements: [],
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
    ],
  });
  elements.push({
    tag: "column_set",
    flex_mode: "none",
    horizontal_spacing: "8px",
    margin: "2px 0 0 0",
    columns: [
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: [dashboardButton(dashboardReport, state.topicKeyword)],
      },
      ...(controlsMode === "tools"
        ? [{
            tag: "column",
            width: "auto",
            vertical_align: "center",
            elements: [cardToolsOverflow(state, "full")],
          }]
        : []),
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        elements: [],
      },
      ...(state.interactiveExpiresAt
        ? [{
            tag: "column",
            width: "auto",
            vertical_align: "center",
            elements: [{
              tag: "div",
              text: {
                tag: "lark_md",
                content: `<font color='grey'>卡片可互动有效期至 ${formatInteractionExpiry(state.interactiveExpiresAt, timezone)}</font>`,
                text_size: "notation",
                text_align: "right",
              },
            }],
          }]
        : []),
    ],
  });

  return {
    schema: "2.0",
    config: {
      ...(interactive ? { update_multi: true } : {}),
      ...forwardingConfig(state),
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

  const identity = cardIdentity(reports, args.projectColors ?? {}, args.projectIcons ?? {}, state.topicKeyword);
  return {
    schema: "2.0",
    config: interactiveCardConfig(identity.title, identity.subtitle, state),
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
              elements: [cardToolsOverflow(state, "collapsed")],
            },
          ],
        },
        ...(state.interactiveExpiresAt
          ? [{
              tag: "div",
              text: {
                tag: "lark_md",
                content: `<font color='grey'>卡片可互动有效期至 ${formatInteractionExpiry(state.interactiveExpiresAt, args.timezone ?? "Asia/Shanghai")}</font>`,
                text_size: "notation",
                text_align: "right",
              },
            }]
          : []),
      ],
    },
  };
}

export function buildRecallConfirmationCard(args: {
  reports: PeriodReport[];
  state: CardViewState;
  returnView: "full" | "collapsed";
  timezone?: string;
}): CardJson {
  const { reports, state, returnView } = args;
  if (reports.length === 0) throw new Error("日报至少需要包含一个项目期次");

  const title = reports.length === 1 ? reports[0]!.period.period : "项目每日速览";
  const actionState = { ...cardStateValue(state), return_view: returnView };
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      ...forwardingConfig(state),
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
        ...(state.interactiveExpiresAt
          ? [{
              tag: "div",
              text: {
                tag: "lark_md",
                content: `<font color='grey'>卡片可互动有效期至 ${formatInteractionExpiry(state.interactiveExpiresAt, args.timezone ?? "Asia/Shanghai")}</font>`,
                text_size: "notation",
              },
            }]
          : []),
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

export function buildLoadingReportCard(state: CardViewState, timezone = "Asia/Shanghai"): CardJson {
  return {
    schema: "2.0",
    config: interactiveCardConfig("日报更新中", "正在读取最新数据", state),
    header: {
      template: "blue",
      title: { tag: "plain_text", content: "日报更新中" },
      subtitle: { tag: "plain_text", content: "正在读取最新数据" },
      icon: { tag: "standard_icon", token: "refresh_outlined" },
      padding: "12px",
    },
    body: {
      direction: "vertical",
      padding: "20px 12px",
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: "**正在更新日报**\n<font color='grey'>数据读取完成后会自动替换当前卡片，请稍候。</font>",
            text_align: "center",
          },
        },
        ...(state.interactiveExpiresAt
          ? [{
              tag: "div",
              text: {
                tag: "lark_md",
                content: `<font color='grey'>卡片可互动有效期至 ${formatInteractionExpiry(state.interactiveExpiresAt, timezone)}</font>`,
                text_size: "notation",
                text_align: "left",
              },
            }]
          : []),
      ],
    },
  };
}

export function buildReportUpdateErrorCard(
  state: CardViewState,
  message: string,
  timezone = "Asia/Shanghai",
): CardJson {
  return {
    schema: "2.0",
    config: interactiveCardConfig("日报更新失败", "请重新加载", state),
    header: {
      template: "red",
      title: { tag: "plain_text", content: "日报更新失败" },
      subtitle: { tag: "plain_text", content: "请重新加载" },
      icon: { tag: "standard_icon", token: "warning_outlined" },
      padding: "12px",
    },
    body: {
      direction: "vertical",
      padding: "16px 12px",
      vertical_spacing: "10px",
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `<font color='grey'>${safeMarkdownText(message.slice(0, 120))}</font>`,
          },
        },
        button("重新加载", "retry_report", {
          action: "cancel_card_tools",
          ...cardStateValue(state),
          return_view: "full",
        }, true, "primary"),
        ...(state.interactiveExpiresAt
          ? [{
              tag: "div",
              text: {
                tag: "lark_md",
                content: `<font color='grey'>卡片可互动有效期至 ${formatInteractionExpiry(state.interactiveExpiresAt, timezone)}</font>`,
                text_size: "notation",
              },
            }]
          : []),
      ],
    },
  };
}

function cardIdentity(
  reports: PeriodReport[],
  projectColors: ProjectColors,
  projectIcons: ProjectIcons,
  topicKeyword?: string,
): {
  title: string;
  subtitle: string;
  theme: CardColor;
  iconKey?: string;
  topicKeyword?: string;
} {
  const focusedReport = reports.length === 1 ? reports[0] : undefined;
  const firstReport = reports[0]!;
  const sharedProject = reports.length > 1 && reports.every(
    (report) => report.period.projectId === firstReport.period.projectId,
  );
  const themedReport = focusedReport ?? (sharedProject ? firstReport : undefined);
  return {
    title: focusedReport
      ? focusedReport.period.period
      : sharedProject
        ? `${firstReport.period.projectDisplayName} · 多期速览`
        : "项目每日速览",
    subtitle: `统计区间 ${firstReport.range.from} — ${firstReport.range.to}`,
    theme: themedReport ? colorFor(themedReport.period.projectId, projectColors) : "blue",
    ...(themedReport && projectIcons[themedReport.period.projectId]
      ? { iconKey: projectIcons[themedReport.period.projectId] }
      : {}),
    ...(topicKeyword ? { topicKeyword } : {}),
  };
}

function interactiveCardConfig(title: string, subtitle: string, state: CardViewState): Record<string, unknown> {
  return {
    update_multi: true,
    ...forwardingConfig(state),
    summary: { content: `${title}｜${subtitle}` },
    style: cardColorStyle,
  };
}

function forwardingConfig(state: CardViewState): Record<string, boolean> {
  const enableForward = state.enableForward ?? false;
  return {
    enable_forward: enableForward,
    enable_forward_interaction: enableForward && (state.enableForwardInteraction ?? false),
  };
}

function cardHeader(identity: ReturnType<typeof cardIdentity>): Record<string, unknown> {
  return {
    template: identity.theme,
    title: { tag: "plain_text", content: identity.title },
    subtitle: { tag: "plain_text", content: identity.subtitle },
    ...(identity.topicKeyword
      ? {
          text_tag_list: [{
            tag: "text_tag",
            text: { tag: "plain_text", content: `#${identity.topicKeyword}` },
            color: identity.theme,
          }],
        }
      : {}),
    icon: identity.iconKey
      ? { tag: "custom_icon", img_key: identity.iconKey }
      : { tag: "standard_icon", token: "chart-pie_outlined" },
    padding: "12px",
  };
}

function cardToolsOverflow(state: CardViewState, view: "full" | "collapsed"): CardElement {
  return {
    tag: "overflow",
    element_id: view === "full" ? "card_tools" : "collapsed_tools",
    width: "default",
    options: [
      {
        text: { tag: "plain_text", content: view === "full" ? "收起卡片" : "展开卡片" },
        value: view === "full" ? "collapse_card" : "expand_card",
      },
      ...(state.scope === "period"
        ? [{
            text: { tag: "plain_text", content: state.showTrend ? "隐藏趋势图" : "显示趋势图" },
            value: state.showTrend ? "hide_trend" : "show_trend",
          }]
        : []),
      {
        text: { tag: "plain_text", content: "撤回卡片" },
        value: "request_recall",
      },
    ],
    behaviors: [
      {
        type: "callback",
        value: {
          action: "card_tools",
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
    enable_forward: String(state.enableForward ?? false),
    enable_forward_interaction: String((state.enableForward ?? false) && (state.enableForwardInteraction ?? false)),
    show_trend: String(state.showTrend ?? false),
    controls_mode: state.controlsMode ?? "full",
    expires_at: state.interactiveExpiresAt ?? "",
    report_date: state.reportDate ?? "",
    topic_keyword: state.topicKeyword ?? "",
  };
}

function controls(allPeriods: ProjectPeriod[], state: CardViewState, timezone: string): CardElement[] {
  const periodsById = new Map(allPeriods.map((period) => [period.activityPeriodId, period]));
  const availablePeriods = state.periodIds.flatMap((periodId) => {
    const period = periodsById.get(periodId);
    return period ? [period] : [];
  });
  const selected = state.selectedPeriodId
    ? availablePeriods.find((period) => period.activityPeriodId === state.selectedPeriodId)
    : undefined;
  const actionState = cardStateValue(state);
  const aggregateLabel = new Set(availablePeriods.map((period) => period.projectId)).size === 1
    ? "全部期次"
    : "所有项目";
  const showAbsoluteDates = shouldUseAbsoluteDateLabels(state.reportDate, timezone);
  const reportYesterday = state.reportDate ? previousIsoDateValue(state.reportDate) : undefined;

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
                    ...actionState,
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
                  button(aggregateLabel, "view_latest", {
                    action: "show_latest",
                    ...actionState,
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
            button(rankingTitle("today", state.reportDate, reportYesterday, showAbsoluteDates), "rank_today", {
              action: "set_ranking",
              ...actionState,
              ranking_mode: "today",
            }, state.rankingMode === "today"),
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          padding: "8px 0",
          elements: [
            button(rankingTitle("yesterday", state.reportDate, reportYesterday, showAbsoluteDates), "rank_yesterday", {
              action: "set_ranking",
              ...actionState,
              ranking_mode: "yesterday",
            }, state.rankingMode === "yesterday"),
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          padding: "8px 0",
          elements: [
            button("本期 TOP", "rank_period", {
              action: "set_ranking",
              ...actionState,
              ranking_mode: "period",
            }, state.rankingMode === "period"),
          ],
        },
        {
          tag: "column",
          width: "auto",
          vertical_align: "center",
          padding: "8px 8px 8px 0",
          elements: [cardToolsOverflow(state, "full")],
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

function dashboardButton(report: PeriodReport, topicKeyword?: string): CardElement {
  const targetUrl = new URL("https://3h.workspace.lilith.trih.top/");
  targetUrl.searchParams.set("period", String(report.period.projectId));
  targetUrl.searchParams.set("act", String(report.period.activityPeriodId));
  if (topicKeyword) targetUrl.searchParams.set("topics", JSON.stringify([topicKeyword]));
  const appLink = new URL("https://applink.feishu.cn/client/web_app/open");
  appLink.searchParams.set("appId", "cli_aa04e8e9e9795bda");
  appLink.searchParams.set("mode", "appCenter");
  appLink.searchParams.set("reload", "false");
  appLink.searchParams.set("lk_target_url", targetUrl.toString());

  return {
    tag: "button",
    element_id: "project_dashboard",
    type: "primary",
    size: "small",
    width: "default",
    icon: { tag: "standard_icon", token: "chart-pie_outlined" },
    text: { tag: "plain_text", content: topicKeyword ? "话题数据看板" : "项目数据看板" },
    behaviors: [{ type: "open_url", default_url: appLink.toString() }],
  };
}

function reportElements(
  report: PeriodReport,
  rankingMode: CardViewState["rankingMode"],
  timezone: string,
  reportDate: string | undefined,
  showHeading: boolean,
  projectColors: ProjectColors,
  showTrend: boolean,
): CardElement[] {
  const { period, video, live } = report;
  const hasLiveData = hasCumulativeLiveData(live.cumulative);
  const color = colorFor(period.projectId, projectColors);
  const useYesterdayWindow = rankingMode === "yesterday";
  const showAbsoluteDates = shouldUseAbsoluteDateLabels(reportDate, timezone);
  const primaryDate = useYesterdayWindow ? report.range.yesterday : report.range.today;
  const comparisonDate = useYesterdayWindow ? report.range.dayBefore : report.range.yesterday;
  const primaryDay = showAbsoluteDates
    ? `${formatMonthDay(primaryDate)}数据 · `
    : useYesterdayWindow ? "昨日" : "今日";
  const comparisonDay = showAbsoluteDates
    ? `${formatMonthDay(comparisonDate)}数据 · `
    : useYesterdayWindow ? "前日" : "昨日";
  const topTitle = rankingTitle(
    rankingMode,
    report.range.today,
    report.range.yesterday,
    showAbsoluteDates,
  );
  const growthLabel = rankingGrowthLabel(
    rankingMode,
    report.range.today,
    report.range.yesterday,
    showAbsoluteDates,
  );
  const primaryVideo = useYesterdayWindow ? video.yesterday : video.today;
  const comparisonVideo = useYesterdayWindow ? video.dayBefore : video.yesterday;
  const primaryLive = useYesterdayWindow ? live.yesterday : live.today;
  const comparisonLive = useYesterdayWindow ? live.dayBefore : live.yesterday;
  const heading = `<text_tag color='${color}'>${safeMarkdownText(period.projectDisplayName)}</text_tag> **${safeMarkdownText(period.period)}**`;
  const headingElements: CardElement[] = showHeading
    ? [{ tag: "div", text: { tag: "lark_md", content: heading, text_size: "heading" } }]
    : [];
  const dailyMetricColumns: CardElement[] = [
    ...(hasDailyVideoData(primaryVideo)
      ? [highlightMetric(
          `${primaryDay}视频播放`,
          primaryVideo.playCount,
          `新增稿件 ${formatNumber(primaryVideo.contentCount)}\n新增作者 ${formatNumber(primaryVideo.authorCount)}`,
          metricTones.video,
          true,
        )]
      : []),
    ...(hasDailyVideoData(comparisonVideo)
      ? [highlightMetric(
          `${comparisonDay}视频播放`,
          comparisonVideo.playCount,
          `新增稿件 ${formatNumber(comparisonVideo.contentCount)}\n新增作者 ${formatNumber(comparisonVideo.authorCount)}`,
          metricTones.content,
          true,
        )]
      : []),
    ...(hasLiveData
      ? [
          ...(hasDailyLiveData(primaryLive)
            ? [highlightMetric(
                `${primaryDay}开播`,
                `${formatNumber(primaryLive.liveSessionCount)} 场`,
                `参与主播 ${formatNumber(primaryLive.anchorCount)}`,
                metricTones.live,
              )]
            : []),
          ...(hasDailyLiveData(comparisonLive)
            ? [highlightMetric(
                `${comparisonDay}开播`,
                `${formatNumber(comparisonLive.liveSessionCount)} 场`,
                `参与主播 ${formatNumber(comparisonLive.anchorCount)}`,
                metricTones.activity,
              )]
            : []),
        ]
      : []),
  ];
  const dailyMetrics: CardElement[] = dailyMetricColumns.length > 0
    ? [{
        tag: "column_set",
        flex_mode: hasLiveData ? "flow" : "bisect",
        horizontal_spacing: "6px",
        margin: "2px 0",
        columns: dailyMetricColumns,
      }]
    : [];
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
          content: `**本期累计数据**　播放 ${formatNumber(video.cumulative.playCount)}　·　稿件 ${formatNumber(video.cumulative.contentCount)}　·　作者 ${formatNumber(video.cumulative.authorCount)}${hasLiveData ? `\n直播PV ${formatNumber(live.cumulative.liveExposurePv)}　·　场次 ${formatNumber(live.cumulative.liveSessionCount)}　·　主播 ${formatNumber(live.cumulative.anchorCount)}` : ""}`,
          text_size: "notation",
        },
      },
      compactTopGrowthElement(video.topGrowth, timezone, topTitle, growthLabel),
    ];
  }

  return [
    ...headingElements,
    ...dailyMetrics,
    {
      tag: "div",
      margin: "6px 0 0 0",
      text: {
        tag: "lark_md",
        content: "**本期累计数据**",
        text_size: "notation",
      },
    },
    {
      tag: "column_set",
      flex_mode: "bisect",
      horizontal_spacing: "6px",
      margin: "2px 0",
      columns: cumulativeMetrics,
    },
    ...(showTrend ? [videoTrendChart(report, color)] : []),
    {
      tag: "div",
      margin: "4px 0 2px 0",
      text: {
        tag: "lark_md",
        content: `**${topTitle} · 视频播放**`,
      },
    },
    ...topGrowthElements(video.topGrowth, timezone, growthLabel),
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
        height: "100px",
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
  title: string,
  growthLabel: string,
): CardElement {
  if (items.length === 0) {
    return {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${title} · 视频播放**\n<font color='grey'>暂无播放增长数据</font>`,
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
      content: `**${title} · 视频播放**\n${rows.join("\n")}`,
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

function hasDailyVideoData(summary: PeriodReport["video"]["today"]): boolean {
  return summary.playCount !== 0 || summary.contentCount !== 0 || summary.authorCount !== 0;
}

function hasDailyLiveData(summary: PeriodReport["live"]["today"]): boolean {
  return summary.liveSessionCount !== 0 || summary.anchorCount !== 0;
}

function videoTrendChart(report: PeriodReport, theme: CardColor): CardElement {
  const points = report.video.trend;
  if (points.length < 2) {
    return {
      tag: "div",
      margin: "4px 0",
      text: { tag: "plain_text", content: "暂无足够的每日趋势数据", text_color: "grey" },
    };
  }

  const palette = chartPalettes[theme];
  const values = (metric: string, field: "playCount" | "contentCount" | "authorCount") =>
    points.map((point) => ({ date: point.date.slice(5).replace("-", "/"), metric, value: point[field] }));

  return {
    tag: "chart",
    element_id: "video_daily_trend",
    height: "340px",
    margin: "8px -12px 6px -12px",
    preview: true,
    chart_spec: {
      type: "common",
      autoFit: true,
      title: { visible: true, text: "每日数据趋势" },
      color: [palette.play, palette.content, palette.author],
      data: [
        { id: "play_data", values: values("视频播放", "playCount") },
        { id: "content_data", values: values("新增稿件", "contentCount") },
        { id: "author_data", values: values("新增作者", "authorCount") },
      ],
      series: [
        {
          id: "play_series",
          type: "area",
          dataIndex: 0,
          xField: "date",
          yField: "value",
          seriesField: "metric",
          area: { style: { fill: palette.fill, fillOpacity: 0.72 } },
          line: { style: { stroke: palette.play, lineWidth: 2 } },
        },
        {
          id: "content_series",
          type: "line",
          dataIndex: 1,
          xField: "date",
          yField: "value",
          seriesField: "metric",
          line: { style: { stroke: palette.content, lineWidth: 2 } },
          point: { visible: false },
        },
        {
          id: "author_series",
          type: "line",
          dataIndex: 2,
          xField: "date",
          yField: "value",
          seriesField: "metric",
          line: { style: { stroke: palette.author, lineWidth: 2 } },
          point: { visible: false },
        },
      ],
      axes: [
        { orient: "bottom", type: "band", label: { visible: true, autoRotate: true, autoHide: true } },
        {
          orient: "left",
          type: "linear",
          seriesId: ["play_series"],
          title: { visible: true, text: "视频播放（左轴）" },
          nice: true,
        },
        {
          orient: "right",
          type: "linear",
          seriesId: ["content_series", "author_series"],
          title: { visible: true, text: "新增稿件 / 作者（右轴）" },
          grid: { visible: false },
          nice: true,
        },
      ],
      legends: { visible: true, orient: "bottom" },
      tooltip: { visible: true },
      padding: { top: 34, right: 16, bottom: 24, left: 16 },
    },
  };
}

function topGrowthElements(
  items: PeriodReport["video"]["topGrowth"],
  timezone: string,
  growthLabel: string,
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

function colorFor(projectId: number, projectColors: ProjectColors): CardColor {
  return projectColors[projectId] ?? defaultProjectColors[projectId] ?? "blue";
}

function rankingTitle(
  mode: CardViewState["rankingMode"],
  today?: string,
  yesterday?: string,
  showAbsoluteDates = false,
): string {
  if (mode === "today") return showAbsoluteDates && today ? `${formatMonthDay(today)} TOP` : "今日 TOP";
  if (mode === "yesterday") return showAbsoluteDates && yesterday ? `${formatMonthDay(yesterday)} TOP` : "昨日 TOP";
  return "本期 TOP";
}

function rankingGrowthLabel(
  mode: CardViewState["rankingMode"],
  today: string,
  yesterday: string,
  showAbsoluteDates: boolean,
): string {
  if (mode === "today") return showAbsoluteDates ? `${formatMonthDay(today)}新增` : "今日新增";
  if (mode === "yesterday") return showAbsoluteDates ? `${formatMonthDay(yesterday)}新增` : "昨日新增";
  return "本期新增";
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

function formatInteractionExpiry(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeMarkdownText(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shouldUseAbsoluteDateLabels(reportDate: string | undefined, timezone: string): boolean {
  return Boolean(reportDate && reportDate !== currentIsoDate(timezone));
}

function currentIsoDate(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function previousIsoDateValue(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function formatMonthDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return safeMarkdownText(value);
  return `${Number(match[2])}月${Number(match[3])}日`;
}
