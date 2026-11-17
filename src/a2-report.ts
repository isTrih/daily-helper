import { z } from "zod";
import { A2Base, A2_GAMES, a2Dates } from "./a2-service.ts";
import type { LarkService } from "./lark-service.ts";
import type { CardJson } from "./types.ts";

export const A2_THEMES: Record<string, { hex: string; dark: string; token: string; template: string }> = {
  w: { hex: "#626b78", dark: "#b7bec8", token: "cus-0", template: "grey" },
  rok: { hex: "#a16f00", dark: "#f0c567", token: "cus-1", template: "yellow" },
  samo: { hex: "#bf3030", dark: "#ff9b98", token: "cus-2", template: "red" },
  pgame: { hex: "#8051b9", dark: "#c3a0ef", token: "cus-3", template: "purple" },
};
const SHARE_BANDS = [
  { hex: "#626b78", dark: "#b7bec8", token: "cus-4" },
  { hex: "#2766a8", dark: "#8cbdff", token: "cus-5" },
  { hex: "#8051b9", dark: "#c3a0ef", token: "cus-6" },
  { hex: "#a55b08", dark: "#ffc47d", token: "cus-7" },
  { hex: "#bf3030", dark: "#ff9b98", token: "cus-8" },
];
export function brandShare(own: number, other: number) {
  const percent = other > 0 ? own / other * 100 : null;
  const tier = percent === null ? 0 : Math.min(4, Math.max(0, Math.floor(percent / 20)));
  return { percent, tier, text: percent === null ? "暂无对照" : percent.toFixed(2) + "%", ...SHARE_BANDS[tier]! };
}
const colorText = (text: string, color: string) => "<font color='" + color + "'>" + text + "</font>";
export const A2_REPORT_GAMES = A2_GAMES.filter(game => game.code !== "d1");
export const A2_DASHBOARD_URL = "https://lilithgames.feishu.cn/wiki/V1vYwn6OxiayQlkajqWcSVLNnpc?table=wbpaxcxrwV";
export const a2ReportRequest = z.strictObject({
  gameCodes: z.array(z.enum(["w", "rok", "samo", "pgame"])).min(1).max(4).transform(codes => [...new Set(codes)]),
});
export type A2Point = { date: string; A2: number; other_A2: number };
export type A2GameReport = { code: string; name: string; points: A2Point[]; latest: A2Point; previous?: A2Point; week?: A2Point; stale: boolean; missingDays: number; theme: typeof A2_THEMES[string]; share: ReturnType<typeof brandShare> };
export type A2ViewState = { gameCodes: string[]; selectedGame: string; reportDate: string; expiresAt: string };
const dateOffset = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
export const wan = (value: number) => `${(value / 10000).toFixed(2)}万`;
export function delta(current: number, previous?: number) {
  if (previous === undefined) return "暂无对照";
  const diff = current - previous;
  const ratio = previous === 0 ? "基数为零" : `${diff >= 0 ? "+" : ""}${(diff / previous * 100).toFixed(2)}%`;
  return `${diff > 0 ? "+" : ""}${wan(diff)}（${ratio}）`;
}
export function summarizeA2(code: string, name: string, all: A2Point[], now = new Date(), available = a2Dates(now).dates[0]!): A2GameReport {
  const valid = all.filter(row => row.date <= available).sort((a, b) => a.date.localeCompare(b.date));
  const latest = valid.at(-1);
  if (!latest) throw new Error(`${name}暂无可用 A2 数据`);
  const byDate = new Map(valid.map(row => [row.date, row]));
  const points = valid.filter(row => row.date >= dateOffset(latest.date, -14));
  return { code, name, latest, points, theme: A2_THEMES[code]!, share: brandShare(latest.A2, latest.other_A2), stale: latest.date < available, missingDays: 15 - points.length,
    ...(byDate.get(dateOffset(latest.date, -1)) ? { previous: byDate.get(dateOffset(latest.date, -1))! } : {}),
    ...(byDate.get(dateOffset(latest.date, -7)) ? { week: byDate.get(dateOffset(latest.date, -7))! } : {}),
  };
}
export function coloredDelta(current: number, previous?: number) { return colorText(delta(current, previous), previous === undefined || current === previous ? "grey" : current > previous ? "red" : "green"); }
const markdown = (content: string) => ({ tag: "markdown", content });
export const A2_CONTACT_ID = "ou_c909863fbf86e93840200f4d30a2229c";
export function a2Footnote(state: A2ViewState): Record<string, unknown>[] {
  const expiry = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(state.expiresAt));
  return [
    { tag: "column_set", flex_mode: "none", horizontal_spacing: "6px", columns: [
      { tag: "column", width: "weighted", weight: 1, elements: [] },
      { tag: "column", width: "auto", vertical_align: "center", elements: [{ tag: "div", text: { tag: "lark_md", text_size: "notation", content: "<font color='grey'>有疑问找</font>" } }] },
      { tag: "column", width: "auto", vertical_align: "center", elements: [{ tag: "person", element_id: "a2_report_contact", size: "extra_small", user_id: A2_CONTACT_ID, show_avatar: true, show_name: true, style: "capsule" }] },
    ] },
    { tag: "div", text: { tag: "lark_md", text_size: "notation", text_align: "right", content: "<font color='grey'>卡片可互动有效期至 " + expiry + "</font>" } },
  ];
}
export function a2SwitchControls(state: A2ViewState): Record<string, unknown>[] {
  const button = (code: string, label: string) => ({
    tag: "button", element_id: `a2_view_${code}`, type: state.selectedGame === code ? "primary" : "default", size: "small", width: "fill",
    text: { tag: "plain_text", content: label },
    behaviors: [{ type: "callback", value: { action: "a2_switch", game_codes: state.gameCodes, selected_game: code, report_date: state.reportDate, expires_at: state.expiresAt } }],
  });
  const games = A2_REPORT_GAMES.filter(game => state.gameCodes.includes(game.code));
  const result: Record<string, unknown>[] = [];
  if (games.length > 1) result.push(button("overview", "整体概览"));
  for (let i = 0; i < games.length; i += 2) {
    result.push({ tag: "column_set", flex_mode: "none", horizontal_spacing: "8px", columns: games.slice(i, i + 2).map(game => ({ tag: "column", width: "weighted", weight: 1, elements: [button(game.code, game.name)] })) });
  }
  return result;
}
export function buildA2Card(reports: A2GameReport[], state: A2ViewState = { gameCodes: reports.map(r => r.code), selectedGame: reports.length === 1 ? reports[0]!.code : "overview", reportDate: a2Dates().dates[0]!, expiresAt: new Date(Date.now() + 14 * 86400000).toISOString() }): CardJson {
  const single = reports.length === 1;
  const elements: Record<string, unknown>[] = [];
  if (single) {
    const r = reports[0]!;
    elements.push(markdown(`${colorText("**" + wan(r.latest.A2) + "**", r.theme.token)}　较前日 ${coloredDelta(r.latest.A2, r.previous?.A2)}\n其他品牌 ${wan(r.latest.other_A2)}　对比占比 ${colorText("**" + r.share.text + "**", r.share.token)}\n较 7 日前 ${coloredDelta(r.latest.A2, r.week?.A2)}`));
    elements.push({ tag: "chart", element_id: "a2_15_day_trend", height: "280px", preview: true,
      chart_spec: {
        type: "common", autoFit: true, color: ["#b8cbd9", r.theme.hex],
        data: [
          { id: "other", values: r.points.map(p => ({ date: p.date.slice(5), value: Number((p.other_A2 / 10000).toFixed(2)), metric: "其他品牌 A2" })) },
          { id: "own", values: r.points.map(p => ({ date: p.date.slice(5), value: Number((p.A2 / 10000).toFixed(2)), metric: "游戏 A2" })) },
        ],
        series: [
          { id: "other_area", type: "area", dataIndex: 0, xField: "date", yField: "value", seriesField: "metric", area: { style: { fill: "#b8cbd9", fillOpacity: 0.38 } }, line: { style: { stroke: "#8caac0", lineWidth: 1 } }, point: { visible: false } },
          { id: "own_line", type: "line", dataIndex: 1, xField: "date", yField: "value", seriesField: "metric", line: { style: { stroke: r.theme.hex, lineWidth: 3 } }, point: { visible: true, style: { size: 4, fill: r.theme.hex } } },
        ],
        axes: [
          { orient: "bottom", type: "band", label: { autoHide: true, autoRotate: false } },
          { orient: "left", type: "linear", seriesId: ["own_line"], zero: false, nice: true, title: { visible: true, text: "游戏 A2（万）" } },
          { orient: "right", type: "linear", seriesId: ["other_area"], zero: true, nice: true, grid: { visible: false }, title: { visible: true, text: "其他品牌 A2（万）" } },
        ], legends: { visible: true, orient: "bottom" }, tooltip: { visible: true }, padding: { top: 12, right: 12, bottom: 12, left: 12 },
      } });
  } else {
    for (const r of reports) {
      elements.push({ tag: "column_set", flex_mode: "none", horizontal_spacing: "8px", columns: [
        { tag: "column", width: "weighted", weight: 1, elements: [markdown(`${colorText("**" + r.name + "**", r.theme.token)}\n<font color='grey'>${r.latest.date}${r.stale ? " · 待更新" : ""}</font>`)] },
        { tag: "column", width: "weighted", weight: 2, elements: [markdown(`**${wan(r.latest.A2)}**　较前日 ${coloredDelta(r.latest.A2, r.previous?.A2)}\n较 7 日前 ${coloredDelta(r.latest.A2, r.week?.A2)} · 占比 ${colorText("**" + r.share.text + "**", r.share.token)}`)] },
      ] });
    }
  }
  if (reports.some(r => r.stale)) elements.push(markdown("<font color='orange'>部分游戏数据尚未更新，以上已标明实际数据日期。</font>"));
  elements.push(...a2SwitchControls(state));
  elements.push({
    tag: "button", element_id: "a2_dashboard", type: "primary", size: "small", width: "default",
    text: { tag: "plain_text", content: "看板及数据" },
    icon: { tag: "standard_icon", token: "chart-pie_outlined" },
    behaviors: [{ type: "open_url", default_url: A2_DASHBOARD_URL, pc_url: A2_DASHBOARD_URL, ios_url: A2_DASHBOARD_URL, android_url: A2_DASHBOARD_URL }],
  });
  elements.push(...a2Footnote(state));
  return { schema: "2.0", config: { wide_screen_mode: true, update_multi: true, enable_forward: true, enable_forward_interaction: true, style: { color: Object.fromEntries([...Object.values(A2_THEMES), ...SHARE_BANDS].map(tone => [tone.token, { light_mode: tone.hex, dark_mode: tone.dark }])) } },
    header: { template: single ? reports[0]!.theme.template : "blue", title: { tag: "plain_text", content: single ? `${reports[0]!.name} · A2 日报` : "A2 日报 · 游戏概览" },
      subtitle: { tag: "plain_text", content: single ? `数据日期 ${reports[0]!.latest.date} · 近15天` : `${reports.length} 款游戏 · 单位：万` } },
    body: { padding: "12px 12px 8px 12px", elements },
  };
}
export function buildA2LoadingCard(failed = false): CardJson {
  return { schema: "2.0", config: { update_multi: true, enable_forward: true, enable_forward_interaction: true },
    header: { template: failed ? "grey" : "blue", title: { tag: "plain_text", content: failed ? "A2 数据读取失败" : "正在读取 A2 数据" } },
    body: { elements: [markdown(failed ? "多维表数据暂时读取失败，请稍后重试。" : "正在读取多维表，完成后自动更新这张卡片。") ] },
  };
}
export class A2ReportService {
  private cache = new Map<string, { at: number; rows: A2Point[] }>();
  constructor(private readonly source: Pick<A2Base, "readDaily">, private readonly lark?: Pick<LarkService, "sendCard" | "updateCard">) {}
  async preview(codes: string[]) {
    return this.view(codes, codes.length === 1 ? codes[0]! : "overview");
  }
  async view(codes: string[], selectedGame: string, reportDate = a2Dates().dates[0]!, expiresAt = new Date(Date.now() + 14 * 86400000).toISOString()) {
    const input = a2ReportRequest.parse({ gameCodes: codes });
    if (selectedGame !== "overview" && !input.gameCodes.includes(selectedGame as never)) throw new Error("游戏不在这张卡片的发送范围内");
    const reports: A2GameReport[] = [];
    for (const game of A2_REPORT_GAMES.filter(game => input.gameCodes.includes(game.code as never) && (selectedGame === "overview" || game.code === selectedGame))) {
      let cached = this.cache.get(game.code);
      if (!cached || Date.now() - cached.at > 30000) {
        cached = { at: Date.now(), rows: await this.source.readDaily(game.name) }; this.cache.set(game.code, cached);
      }
      reports.push(summarizeA2(game.code, game.name, cached.rows, new Date(), reportDate));
    }
    return { cards: [buildA2Card(reports, { gameCodes: input.gameCodes, selectedGame, reportDate, expiresAt })], reports, dashboardUrl: A2_DASHBOARD_URL, viewState: { gameCodes: input.gameCodes, selectedGame, reportDate, expiresAt } };
  }
  async send(codes: string[], chats: string[]) {
    if (!this.lark) throw new Error("未配置飞书应用，无法发送 A2 日报");
    const chatIds = [...new Set(chats.map(chat => chat.trim()).filter(Boolean))];
    if (!chatIds.length) throw new Error("请选择发送群聊");
    a2ReportRequest.parse({ gameCodes: codes });
    const messages: Array<{ chatId: string; messageId: string }> = [];
    const pending = new Set<string>();
    try {
      for (const chatId of chatIds) {
        const messageId = await this.lark.sendCard(chatId, buildA2LoadingCard());
        messages.push({ chatId, messageId }); pending.add(messageId);
      }
      const { cards } = await this.preview(codes);
      for (const { messageId } of messages) {
        await this.lark.updateCard(messageId, cards[0]!); pending.delete(messageId);
      }
      return { cardCount: 1, messageCount: messages.length, messages };
    } catch (error) {
      const outcomes = await Promise.allSettled([...pending].map(messageId => this.lark!.updateCard(messageId, buildA2LoadingCard(true))));
      if (outcomes.some(result => result.status === "rejected")) console.error("[a2-report] 部分读取失败提示未能更新，请重试");
      throw error;
    }
  }
}
