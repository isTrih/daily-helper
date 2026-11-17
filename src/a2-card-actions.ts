import { z } from "zod";
import { a2Dates } from "./a2-service.ts";
import { a2Footnote, a2SwitchControls, type A2ReportService, type A2ViewState } from "./a2-report.ts";
import type { CardActionResponse, LongConnectionCardActionEvent } from "./lark-service.ts";
import type { CardJson } from "./types.ts";

const actionSchema = z.strictObject({
  action: z.literal("a2_switch"),
  game_codes: z.array(z.enum(["w", "rok", "samo", "pgame"])).min(1).max(4),
  selected_game: z.enum(["overview", "w", "rok", "samo", "pgame"]),
  report_date: z.iso.date(), expires_at: z.iso.datetime(),
});
type Handler = (event: LongConnectionCardActionEvent) => Promise<CardActionResponse>;
export function routeReportCardActions(project: Handler, a2: Handler): Handler {
  return event => {
    const value = event.action?.value;
    return value && typeof value === "object" && "action" in value && value.action === "a2_switch" ? a2(event) : project(event);
  };
}
export function createA2CardActionHandler(reports: Pick<A2ReportService, "view"> | undefined, updateCard?: (messageId: string, card: CardJson) => Promise<void>, waitMs = 2400): Handler {
  return async event => {
    try {
      const action = actionSchema.parse(event.action?.value);
      // select_static reports the newly chosen option separately from its value.
      // Keep the value fallback for previously sent button-based cards.
      const selectedGame = z.enum(["overview", "w", "rok", "samo", "pgame"]).parse(event.action?.option ?? action.selected_game);
      if (!reports) throw new Error("A2 日报服务未配置");
      if (Date.parse(action.expires_at) <= Date.now()) throw new Error("卡片已过互动有效期，请重新发送 A2 日报");
      if (action.report_date > a2Dates().dates[0]!) throw new Error("卡片数据日期无效");
      if (selectedGame !== "overview" && !action.game_codes.includes(selectedGame)) throw new Error("游戏不在这张卡片的发送范围内");
      const state: A2ViewState = { gameCodes: action.game_codes, selectedGame, reportDate: action.report_date, expiresAt: action.expires_at };
      const task = reports.view(state.gameCodes, state.selectedGame, state.reportDate, state.expiresAt);
      const messageId = event.context?.open_message_id ?? event.open_message_id;
      if (!updateCard || !messageId) return { card: { type: "raw", data: (await task).cards[0]! } };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        task.then(value => ({ status: "ready" as const, value }), error => ({ status: "error" as const, error })),
        new Promise<{ status: "pending" }>(resolve => { timer = setTimeout(() => resolve({ status: "pending" }), waitMs); }),
      ]);
      if (timer) clearTimeout(timer);
      if (result.status === "error") throw result.error;
      if (result.status === "ready") return { card: { type: "raw", data: result.value.cards[0]! } };
      // Keep the callback below Feishu's 3-second limit. Slow reads finish via CardKit.
      void task.then(async value => { await updateCard(messageId, value.cards[0]!); }).catch(async () => {
        try {
          await updateCard(messageId, { schema: "2.0", config: { update_multi: true, enable_forward: true, enable_forward_interaction: true },
            header: { template: "grey", title: { tag: "plain_text", content: "A2 日报更新失败" } },
            body: { elements: [{ tag: "markdown", content: "多维表读取未完成，请点击游戏按钮重试。" }, ...a2SwitchControls(state), ...a2Footnote(state)] } });
        } catch { console.error("[a2-card] 无法更新卡片，请在原卡重试"); }
      });
      return { toast: { type: "info", content: "正在读取多维表，完成后自动切换" } };
    } catch (error) {
      return { toast: { type: "error", content: error instanceof z.ZodError ? "A2 卡片参数无效，请重新发送" : error instanceof Error ? error.message.slice(0, 100) : "切换失败，请稍后重试" } };
    }
  };
}
