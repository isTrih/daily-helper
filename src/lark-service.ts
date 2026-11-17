import * as lark from "@larksuiteoapi/node-sdk";
import type { CardJson, ChatOption } from "./types.ts";
import type { Recipient } from "./recipients.ts";
import { readGroupUsers } from "./lark-group-members.ts";

const silentHttpLogger = {
  error: (..._messages: unknown[]) => {},
  warn: (..._messages: unknown[]) => {},
  info: (..._messages: unknown[]) => {},
  debug: (..._messages: unknown[]) => {},
  trace: (..._messages: unknown[]) => {},
};

export interface LongConnectionCardActionEvent {
  open_message_id?: string;
  action?: {
    value?: unknown;
    tag?: string;
    name?: string;
    option?: string;
  };
  context?: {
    open_message_id?: string;
    open_chat_id?: string;
  };
  operator?: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
}

export interface LongConnectionMessageEvent {
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content: string;
    mentions?: Array<{ key: string; name?: string }>;
  };
}

export type CardActionResponse = {
  toast?: { type: "info" | "success" | "error" | "warning"; content: string };
  card?: { type: "raw"; data: CardJson };
};

export class LarkService {
  private readonly client: lark.Client;
  private wsClient: lark.WSClient | undefined;
  private readonly cardIdsByMessageId = new Map<string, string>();
  private lastCardSequence = Math.floor(Date.now() / 1_000) - 1;
  private directory?: { at: number; result: Awaited<ReturnType<typeof readGroupUsers>> };
  private directoryLoading: Promise<Awaited<ReturnType<typeof readGroupUsers>>> | undefined;

  async listUsers(refresh = false) {
    if (!refresh && this.directory && Date.now() - this.directory.at < 300_000) return this.directory.result;
    if (!this.directoryLoading) this.directoryLoading = this.listChats().then(chats => readGroupUsers(this.client, chats)).then(result => {
      this.directory = { at: Date.now(), result }; return result;
    }).finally(() => { this.directoryLoading = undefined; });
    return this.directoryLoading;
  }

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {
    this.client = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.error,
      logger: silentHttpLogger,
    });
  }

  async listChats(): Promise<ChatOption[]> {
    const chats: ChatOption[] = [];
    let pageToken: string | undefined;
    const seen = new Set<string>();

    do {
      const response = await larkRequest(
        "读取机器人群聊",
        () => this.client.im.v1.chat.list({
          params: {
            page_size: 100,
            sort_type: "ByActiveTimeDesc",
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        }),
      );
      assertLarkSuccess(response.code, response.msg, "读取机器人群聊");

      for (const item of response.data?.items ?? []) {
        if (!item.chat_id || item.chat_status === "dissolved" || item.chat_mode === "p2p") continue;
        chats.push({
          chatId: item.chat_id,
          name: item.name?.trim() || `群聊 ${item.chat_id.slice(-6)}`,
          ...(item.avatar ? { avatar: item.avatar } : {}),
          ...(item.description ? { description: item.description } : {}),
        });
      }
      pageToken = response.data?.has_more ? response.data.page_token : undefined;
      if (response.data?.has_more) {
        if (!pageToken || seen.has(pageToken)) throw new Error("机器人群聊分页不完整，请刷新重试");
        seen.add(pageToken);
      }
    } while (pageToken);

    return chats;
  }

  async sendCard(target: string | Recipient, card: CardJson): Promise<string> {
    const chatId = typeof target === "string" ? target : target.id;
    const receiveIdType = typeof target !== "string" && target.type === "user" ? "open_id" : "chat_id";
    if (receiveIdType === "chat_id") await this.ensureReportMembers(chatId);
    const cardResponse = await larkRequest(
      "创建卡片实体",
      () => this.client.cardkit.v1.card.create({
        data: { type: "card_json", data: JSON.stringify(card) },
      }),
    );
    assertLarkSuccess(cardResponse.code, cardResponse.msg, "创建卡片实体");
    const cardId = cardResponse.data?.card_id;
    if (!cardId) throw new Error("飞书创建卡片实体成功但未返回 card_id");

    const response = await larkRequest(
      `向会话 ${chatId} 发送卡片`,
      () => this.client.im.v1.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: chatId,
          msg_type: "interactive",
          content: JSON.stringify({ type: "card", data: { card_id: cardId } }),
        },
      }),
    );
    assertLarkSuccess(response.code, response.msg, `向会话 ${chatId} 发送卡片`);
    const messageId = response.data?.message_id;
    if (!messageId) throw new Error("飞书发送成功但未返回 message_id");
    this.cardIdsByMessageId.set(messageId, cardId);
    return messageId;
  }

  private async ensureReportMembers(chatId: string): Promise<void> {
    const chat = await larkRequest("读取发送目标类型", () =>
      this.client.im.v1.chat.get({ path: { chat_id: chatId } }));
    assertLarkSuccess(chat.code, chat.msg, "读取发送目标类型");
    if (chat.data?.chat_mode === "p2p") return;
    if (!["group", "topic"].includes(chat.data?.chat_mode ?? "")) {
      throw new Error("无法确认发送目标的会话类型");
    }

    const missing = new Set(["db9g11bb", "da5da1g1"]);
    let pageToken: string | undefined;
    do {
      const response = await larkRequest("检查日报群成员", () =>
        this.client.im.v1.chatMembers.get({
          path: { chat_id: chatId },
          params: {
            member_id_type: "user_id", page_size: 100,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        }));
      assertLarkSuccess(response.code, response.msg, "检查日报群成员");
      for (const member of response.data?.items ?? []) {
        if (member.member_id) missing.delete(member.member_id);
      }
      if (missing.size === 0) return;
      pageToken = response.data?.has_more ? response.data.page_token : undefined;
      if (response.data?.has_more && !pageToken) throw new Error("读取日报群成员分页不完整");
    } while (pageToken);

    const response = await larkRequest("邀请李思远、徐亚男加入日报群", () =>
      this.client.im.v1.chatMembers.create({
        path: { chat_id: chatId },
        params: { member_id_type: "user_id" },
        data: { id_list: [...missing] },
      }));
    assertLarkSuccess(response.code, response.msg, "邀请李思远、徐亚男加入日报群");
    const unresolved = [
      ...(response.data?.invalid_id_list ?? []),
      ...(response.data?.not_existed_id_list ?? []),
      ...(response.data?.pending_approval_id_list ?? []),
    ];
    if (unresolved.length) throw new Error(`日报群成员未能全部加入（失败或待审批）：${unresolved.join("、")}`);
  }

  async updateCard(messageId: string, card: CardJson): Promise<void> {
    const cardId = await this.resolveCardId(messageId);
    const response = await larkRequest(
      `更新消息卡片 ${messageId}`,
      () => this.client.cardkit.v1.card.update({
        path: { card_id: cardId },
        data: {
          card: { type: "card_json", data: JSON.stringify(card) },
          sequence: this.nextCardSequence(),
        },
      }),
    );
    assertLarkSuccess(response.code, response.msg, `更新消息卡片 ${messageId}`);
  }

  async recallMessage(messageId: string): Promise<void> {
    const response = await larkRequest(
      `撤回消息 ${messageId}`,
      () => this.client.im.v1.message.delete({ path: { message_id: messageId } }),
    );
    assertLarkSuccess(response.code, response.msg, `撤回消息 ${messageId}`);
  }

  async startCardActionConnection(
    handler: (event: LongConnectionCardActionEvent) => Promise<CardActionResponse>,
    messageHandler: (event: LongConnectionMessageEvent) => Promise<void> = async () => {},
  ): Promise<void> {
    if (this.wsClient) return;

    const eventDispatcher = new lark.EventDispatcher({ loggerLevel: lark.LoggerLevel.info }).register<{
      "card.action.trigger": (data: LongConnectionCardActionEvent) => Promise<CardActionResponse>;
      "im.message.receive_v1": (data: LongConnectionMessageEvent) => Promise<void>;
    }>({
      "card.action.trigger": handler,
      "im.message.receive_v1": messageHandler,
    });

    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.info,
      autoReconnect: true,
      source: "project-daily-report",
      onReady: () => console.info("[lark] 卡片回调长连接已就绪"),
      onReconnecting: () => console.warn("[lark] 长连接断开，正在重连"),
      onReconnected: () => console.info("[lark] 长连接已恢复"),
      onError: (error) => console.error("[lark] 长连接错误", error),
      handshakeTimeoutMs: 10_000,
      wsConfig: { pingTimeout: 10 },
    });
    await this.wsClient.start({ eventDispatcher });
  }

  close(): void {
    this.wsClient?.close({ force: true });
    this.wsClient = undefined;
  }

  private async resolveCardId(messageId: string): Promise<string> {
    const knownCardId = this.cardIdsByMessageId.get(messageId);
    if (knownCardId) return knownCardId;

    const response = await larkRequest(
      `读取消息卡片 ${messageId}`,
      () => this.client.cardkit.v1.card.idConvert({ data: { message_id: messageId } }),
    );
    assertLarkSuccess(response.code, response.msg, `读取消息卡片 ${messageId}`);
    const cardId = response.data?.card_id;
    if (!cardId) throw new Error(`飞书未返回消息 ${messageId} 的 card_id`);
    this.cardIdsByMessageId.set(messageId, cardId);
    return cardId;
  }

  private nextCardSequence(): number {
    this.lastCardSequence = Math.max(Math.floor(Date.now() / 1_000), this.lastCardSequence + 1);
    return this.lastCardSequence;
  }
}

function assertLarkSuccess(code: number | undefined, message: string | undefined, action: string): void {
  if (code !== undefined && code !== 0) {
    throw new Error(`${action}失败：${code} ${message || "未知错误"}`);
  }
}

async function larkRequest<T>(action: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const responseData = getLarkResponseData(error);
    const detail = responseData
      ? `${responseData.code ?? "HTTP"} ${responseData.msg || responseData.message || "请求被拒绝"}`
      : error instanceof Error ? error.message : "未知错误";
    throw new Error(`${action}失败：${detail}`);
  }
}

function getLarkResponseData(error: unknown): { code?: number | string; msg?: string; message?: string } | undefined {
  if (!error || typeof error !== "object" || !("response" in error)) return undefined;
  const response = (error as { response?: { data?: unknown } }).response;
  const data = response?.data;
  if (!data || typeof data !== "object") return undefined;
  return data as { code?: number | string; msg?: string; message?: string };
}
