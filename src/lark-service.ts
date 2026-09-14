import * as lark from "@larksuiteoapi/node-sdk";
import type { CardJson, ChatOption } from "./types.ts";

export interface LongConnectionCardActionEvent {
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

export type CardActionResponse = {
  toast?: { type: "info" | "success" | "error" | "warning"; content: string };
  card?: { type: "raw"; data: CardJson };
};

export class LarkService {
  private readonly client: lark.Client;
  private wsClient: lark.WSClient | undefined;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {
    this.client = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.info,
    });
  }

  async listChats(): Promise<ChatOption[]> {
    const chats: ChatOption[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.client.im.v1.chat.list({
        params: {
          page_size: 100,
          sort_type: "ByActiveTimeDesc",
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });
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
    const response = await this.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });
    assertLarkSuccess(response.code, response.msg, `向群聊 ${chatId} 发送卡片`);
    const messageId = response.data?.message_id;
    if (!messageId) throw new Error("飞书发送成功但未返回 message_id");
    return messageId;
  }

  async startCardActionConnection(
    handler: (event: LongConnectionCardActionEvent) => Promise<CardActionResponse>,
  ): Promise<void> {
    if (this.wsClient) return;

    const eventDispatcher = new lark.EventDispatcher({ loggerLevel: lark.LoggerLevel.info }).register<{
      "card.action.trigger": (data: LongConnectionCardActionEvent) => Promise<CardActionResponse>;
    }>({
      "card.action.trigger": handler,
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
}

function assertLarkSuccess(code: number | undefined, message: string | undefined, action: string): void {
  if (code !== undefined && code !== 0) {
    throw new Error(`${action}失败：${code} ${message || "未知错误"}`);
  }
}
