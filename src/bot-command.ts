import type { LongConnectionMessageEvent } from "./lark-service.ts";

const sendDataKeywords = new Set(["发送数据", "巴拉拉能量"]);
const projectKeywords = new Set(["ROK", "SAMO", "D1"]);

export function createSendDataCommandHandler(
  sendLatestReports: (chatId: string, projectCodes?: string[]) => Promise<void>,
) {
  const handledMessages = new Set<string>();

  return async (event: LongConnectionMessageEvent): Promise<void> => {
    const command = parseSendDataCommand(event);
    if (!command || handledMessages.has(command.messageId)) return;

    handledMessages.add(command.messageId);
    setTimeout(() => handledMessages.delete(command.messageId), 10 * 60 * 1_000);
    void sendLatestReports(command.chatId, command.projectCodes).catch((error) => {
      console.error(`[lark] 响应群聊 ${command.chatId} 的发送数据指令失败`, error);
    });
  };
}

export function parseSendDataCommand(
  event: LongConnectionMessageEvent,
): { chatId: string; messageId: string; projectCodes?: string[] } | undefined {
  const message = event.message;
  if (!message?.chat_id || !message.message_id || message.message_type !== "text") return undefined;

  try {
    const content = JSON.parse(message.content) as { text?: unknown };
    if (typeof content.text !== "string") return undefined;
    let text = content.text;
    for (const mention of message.mentions ?? []) text = text.replaceAll(mention.key, "");
    const keyword = text.replace(/[，,。.!！?？]/g, "").trim();
    if ((message.mentions?.length ?? 0) > 0 && sendDataKeywords.has(keyword.replace(/\s/g, ""))) {
      return { chatId: message.chat_id, messageId: message.message_id };
    }

    const projectMatch = /^巴拉拉能量(.+)$/i.exec(keyword);
    if (!projectMatch) return undefined;
    const suffix = projectMatch[1]!;
    const projectCodes = [...new Set(
      [...suffix.matchAll(/(?:^|[^a-z0-9])(rok|samo|d1)(?=$|[^a-z0-9])/gi)]
        .map((match) => match[1]!.toUpperCase())
        .filter((code) => projectKeywords.has(code)),
    )];
    const residue = suffix
      .replace(/rok|samo|d1/gi, "")
      .replace(/[\s\p{P}\p{S}]/gu, "");
    return projectCodes.length > 0 && residue.length === 0
      ? { chatId: message.chat_id, messageId: message.message_id, projectCodes }
      : undefined;
  } catch {
    return undefined;
  }
}
