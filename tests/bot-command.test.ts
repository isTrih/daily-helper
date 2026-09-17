import { describe, expect, test } from "bun:test";
import { createSendDataCommandHandler, parseSendDataCommand } from "../src/bot-command.ts";

function message(
  text: string,
  mentions = [{ key: "@_user_1", name: "日报机器人" }],
  chatType = "group",
) {
  return {
    message: {
      message_id: "om_command_1",
      chat_id: "oc_group_1",
      chat_type: chatType,
      message_type: "text",
      content: JSON.stringify({ text }),
      mentions,
    },
  };
}

describe("发送数据群聊指令", () => {
  test("识别机器人被提及后的两个关键词", () => {
    expect(parseSendDataCommand(message("@_user_1 发送数据")))
      .toEqual({ chatId: "oc_group_1", messageId: "om_command_1", isPrivateChat: false });
    expect(parseSendDataCommand(message("@_user_1 巴拉拉能量！")))
      .toEqual({ chatId: "oc_group_1", messageId: "om_command_1", isPrivateChat: false });
  });

  test("不提及机器人时仅巴拉拉能量可发送全部项目", () => {
    expect(parseSendDataCommand(message("发送数据", []))).toBeUndefined();
    expect(parseSendDataCommand(message("巴拉拉能量", [])))
      .toEqual({ chatId: "oc_group_1", messageId: "om_command_1", isPrivateChat: false });
    expect(parseSendDataCommand(message("巴拉拉能量！", [])))
      .toEqual({ chatId: "oc_group_1", messageId: "om_command_1", isPrivateChat: false });
  });

  test("项目定向关键词不需要提及机器人且不区分大小写", () => {
    expect(parseSendDataCommand(message("巴拉拉能量 rok", []))).toEqual({
      chatId: "oc_group_1",
      messageId: "om_command_1",
      isPrivateChat: false,
      projectCodes: ["ROK"],
    });
    expect(parseSendDataCommand(message("巴拉拉能量 SAMO", []))?.projectCodes).toEqual(["SAMO"]);
    expect(parseSendDataCommand(message("巴拉拉能量 d1！", []))?.projectCodes).toEqual(["D1"]);
  });

  test("私聊无需 @ 即可使用发送数据和巴拉拉能量", () => {
    expect(parseSendDataCommand(message("发送数据", [], "p2p"))).toEqual({
      chatId: "oc_group_1",
      messageId: "om_command_1",
      isPrivateChat: true,
    });
    expect(parseSendDataCommand(message("数据发送", [], "p2p"))?.isPrivateChat).toBe(true);
    expect(parseSendDataCommand(message("巴拉拉能量 ROK", [], "p2p"))).toEqual({
      chatId: "oc_group_1",
      messageId: "om_command_1",
      isPrivateChat: true,
      projectCodes: ["ROK"],
    });
  });

  test("指令处理器传递私聊上下文", async () => {
    let isPrivateChat = false;
    const handler = createSendDataCommandHandler(async (_chatId, _projectCodes, context) => {
      isPrivateChat = context.isPrivateChat;
    });
    await handler(message("巴拉拉能量", [], "p2p"));
    expect(isPrivateChat).toBe(true);
  });

  test("任意符号分隔的多个项目码生成同一条多合一指令", () => {
    expect(parseSendDataCommand(message("巴拉拉能量 ROK&SAMO｜d1", []))?.projectCodes)
      .toEqual(["ROK", "SAMO", "D1"]);
    expect(parseSendDataCommand(message("巴拉拉能量 ROK 其他内容", []))).toBeUndefined();
  });

  test("立即返回并对重复消息只触发一次", async () => {
    let calls = 0;
    const handler = createSendDataCommandHandler(async () => {
      calls += 1;
      await new Promise(() => {});
    });
    await handler(message("@_user_1 发送数据"));
    await handler(message("@_user_1 发送数据"));
    expect(calls).toBe(1);
  });
});
