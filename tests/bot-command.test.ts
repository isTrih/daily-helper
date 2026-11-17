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

describe("A2 私聊口令",()=>{
 test("私聊识别 a2，忽略大小写与首尾空白，群聊及其他内容不触发",async()=>{
  const {parseA2Command}=await import("../src/bot-command.ts");
  for(const text of ["a2","A2","  a2\n"])expect(parseA2Command(message(text,[],"p2p"))).toEqual({chatId:"oc_group_1",messageId:"om_command_1"});
  for(const text of ["a 2","a2日报","发送a2",""])expect(parseA2Command(message(text,[],"p2p"))).toBeUndefined();
  expect(parseA2Command(message("a2",[],"group"))).toBeUndefined();
  const bad=message("a2",[],"p2p");bad.message.content="{";expect(parseA2Command(bad)).toBeUndefined();
 });
 test("只回复原私聊，立即应答且重复事件只发送一次",async()=>{
  const {createA2CommandHandler}=await import("../src/bot-command.ts");const chats:string[]=[];
  const handler=createA2CommandHandler(async chat=>{chats.push(chat);await new Promise(()=>{});});
  expect(await handler(message("a2",[],"p2p"))).toBe(true);
  expect(await handler(message("A2",[],"p2p"))).toBe(true);
  expect(await handler(message("a2",[],"group"))).toBe(false);
  expect(await handler(message("发送数据",[],"p2p"))).toBe(false);
  expect(chats).toEqual(["oc_group_1"]);
 });
 test("私聊口令默认选中万国觉醒，保留四游戏下拉范围和转发",async()=>{
  const {createA2CommandHandler}=await import("../src/bot-command.ts");const {A2ReportService,A2_REPORT_GAMES}=await import("../src/a2-report.ts");
  const cards:any[]=[];const initial:any[]=[];const targets:string[]=[];const names:string[]=[];
  const service=new A2ReportService({readDaily:async name=>{names.push(name);return[{date:"2026-01-01",A2:100000,other_A2:200000}];}},{sendCard:async(chat,card)=>{targets.push(typeof chat === "string" ? chat : chat.id);initial.push(card);return"message";},updateCard:async(id,card)=>{expect(id).toBe("message");cards.push(card);}});
  let done:()=>void;const finished=new Promise<void>(resolve=>{done=resolve;});
  const handler=createA2CommandHandler(async chat=>{await service.send(A2_REPORT_GAMES.map(g=>g.code),[chat],"rok");done();});
  await handler(message("a2",[],"p2p"));await finished;
  expect(targets).toEqual(["oc_group_1"]);expect(names).toEqual(["万国觉醒"]);
  expect(initial[0].header.title.content).toContain("正在读取");expect(cards[0].header.title.content).toContain("万国觉醒");expect(JSON.stringify(cards[0])).toContain('"initial_option":"rok"');expect(JSON.stringify(cards[0])).toContain('"value":"overview"');expect(cards[0].config.enable_forward).toBe(true);expect(cards[0].config.enable_forward_interaction).toBe(true);expect(JSON.stringify(cards[0])).toContain('"action":"a2_switch"');
 });
});
