import * as lark from "@larksuiteoapi/node-sdk";
import type { CardJson, ChatOption } from "./types.ts";

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
  private lastCardSequence = Date.now();

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
    } while (pageToken);

    return chats;
  }

  async sendCard(chatId: string, card: CardJson): Promise<string> {
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
      `向群聊 ${chatId} 发送卡片`,
      () => this.client.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "interactive",
          content: JSON.stringify({ type: "card", data: { card_id: cardId } }),
        },
      }),
    );
    assertLarkSuccess(response.code, response.msg, `向群聊 ${chatId} 发送卡片`);
    const messageId = response.data?.message_id;
    if (!messageId) throw new Error("飞书发送成功但未返回 message_id");
    this.cardIdsByMessageId.set(messageId, cardId);
    return messageId;
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
    this.lastCardSequence = Math.max(Date.now(), this.lastCardSequence + 1);
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
