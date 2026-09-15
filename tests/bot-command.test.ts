import { describe, expect, test } from "bun:test";
import { createSendDataCommandHandler, parseSendDataCommand } from "../src/bot-command.ts";

function message(text: string, mentions = [{ key: "@_user_1", name: "日报机器人" }]) {
  return {
    message: {
      message_id: "om_command_1",
      chat_id: "oc_group_1",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text }),
      mentions,
    },
  };
}

describe("发送数据群聊指令", () => {
  test("识别机器人被提及后的两个关键词", () => {
    expect(parseSendDataCommand(message("@_user_1 发送数据")))
      .toEqual({ chatId: "oc_group_1", messageId: "om_command_1" });
    expect(parseSendDataCommand(message("@_user_1 巴拉拉能量！")))
      .toEqual({ chatId: "oc_group_1", messageId: "om_command_1" });
  });

  test("不提及机器人时仅巴拉拉能量可发送全部项目", () => {
    expect(parseSendDataCommand(message("发送数据", []))).toBeUndefined();
    expect(parseSendDataCommand(message("巴拉拉能量", [])))
      .toEqual({ chatId: "oc_group_1", messageId: "om_command_1" });
    expect(parseSendDataCommand(message("巴拉拉能量！", [])))
      .toEqual({ chatId: "oc_group_1", messageId: "om_command_1" });
  });

  test("项目定向关键词不需要提及机器人且不区分大小写", () => {
    expect(parseSendDataCommand(message("巴拉拉能量 rok", []))).toEqual({
      chatId: "oc_group_1",
      messageId: "om_command_1",
      projectCodes: ["ROK"],
    });
    expect(parseSendDataCommand(message("巴拉拉能量 SAMO", []))?.projectCodes).toEqual(["SAMO"]);
    expect(parseSendDataCommand(message("巴拉拉能量 d1！", []))?.projectCodes).toEqual(["D1"]);
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
