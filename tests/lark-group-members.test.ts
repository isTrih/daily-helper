import { expect, test } from "bun:test";
import { readGroupUsers } from "../src/lark-group-members.ts";
import { LarkService } from "../src/lark-service.ts";

const chats = [{ chatId: "oc_one", name: "一群" }, { chatId: "oc_two", name: "二群" }];

test("所在群成员分页、跨群去重，只输出姓名与open_id，不含机器人", async () => {
  const visited: string[] = [];
  const client = { im: { v1: { chatMembers: { get: async ({ path, params }: any) => {
    visited.push(path.chat_id + ":" + (params.page_token ?? "first"));
    expect(params.member_id_type).toBe("open_id"); expect(params.check_security_conf).toBe(true);
    const items = path.chat_id === "oc_two" ? [{ member_id: "ou_one", name: "用户一" }, { member_id: "ou_two", name: "用户二", tenant_key: "private" }]
      : params.page_token ? [{ member_id: "ou_one", name: "用户一" }, { member_id: "cli_bot", name: "机器人" }]
      : [{ member_id: "ou_one" }, { member_id: "wrong_type", member_id_type: "user_id" }];
    return { code: 0, data: { items, has_more: path.chat_id === "oc_one" && !params.page_token, page_token: "next" } };
  } } } } };
  const result = await readGroupUsers(client as never, [...chats, chats[0]!]);
  expect(visited).toEqual(["oc_one:first", "oc_one:next", "oc_two:first"]);
  expect([...result.users].sort((a, b) => a.id.localeCompare(b.id))).toEqual([{ id: "ou_one", name: "用户一" }, { id: "ou_two", name: "用户二" }]);
  expect(result.warning).toBe(""); expect(JSON.stringify(result)).not.toContain("private");
});

test("单群失败仍返回其他群成员，所有群失败明确报错", async () => {
  const client = { im: { v1: { chatMembers: { get: async ({ path }: any) => path.chat_id === "oc_one"
    ? { code: 99991672 } : { code: 0, data: { items: [{ member_id: "ou_ok", name: "可用" }] } } } } } };
  const result = await readGroupUsers(client as never, chats);
  expect(result.users).toEqual([{ id: "ou_ok", name: "可用" }]); expect(result.warning).toContain("1 个群");
  await expect(readGroupUsers(client as never, [chats[0]!])).rejects.toThrow("群成员读取权限");
  expect(await readGroupUsers({} as never, [])).toEqual({ users: [], warning: "" });
});

test("成员列表安全截断、缺失及重复分页游标均明确标注不完整", async () => {
  for (const data of [
    { items: [{ member_id: "ou_seen", name: "已读" }], trigger_security_conf_limit: true, has_more: false },
    { items: [{ member_id: "ou_seen", name: "已读" }], has_more: true },
    { items: [{ member_id: "ou_seen", name: "已读" }], has_more: true, page_token: "repeat" },
  ]) {
    let calls = 0;
    const result = await readGroupUsers({ im: { v1: { chatMembers: { get: async () => { calls++; return { code: 0, data }; } } } } } as never, [chats[0]!]);
    expect(result.users).toHaveLength(1); expect(result.warning).not.toBe(""); expect(calls).toBeLessThanOrEqual(2);
  }
});

test("用户列表仅遍历机器人群聊，分页排除私聊和解散群，共享缓存并支持刷新", async () => {
  let lists = 0, members = 0;
  const client = { im: { v1: {
    chat: { list: async ({ params }: any) => {
      lists++;
      return { code: 0, data: params.page_token ? { items: [{ chat_id: "oc_two", name: "二群" }, { chat_id: "oc_dead", chat_status: "dissolved" }], has_more: false }
        : { items: [{ chat_id: "oc_one", name: "一群" }, { chat_id: "oc_private", chat_mode: "p2p" }], has_more: true, page_token: "next" } };
    } },
    chatMembers: { get: async ({ path }: any) => {
      members++; expect(["oc_one", "oc_two"]).toContain(path.chat_id);
      return { code: 0, data: { items: [{ member_id: "ou_shared", name: "用户" }], has_more: false } };
    } },
  } } };
  Object.defineProperty(client, "contact", { get() { throw Error("must never read enterprise contacts"); } });
  const service = new LarkService("fixture", "fixture"); Object.defineProperty(service, "client", { value: client });
  const results = await Promise.all([service.listUsers(), service.listUsers()]);
  expect(results[0]!.users).toEqual([{ id: "ou_shared", name: "用户" }]); expect(lists).toBe(2); expect(members).toBe(2);
  await service.listUsers(); expect(lists).toBe(2);
  await service.listUsers(true); expect(lists).toBe(4); expect(members).toBe(4);
});

test("机器人群聊分页缺少或重复游标时失败，不继续扫描未确认的目标", async () => {
  for (const page_token of [undefined, "repeat"]) {
    let calls = 0;
    const service = new LarkService("fixture", "fixture");
    Object.defineProperty(service, "client", { value: { im: { v1: { chat: { list: async () => { calls++; return { code: 0, data: { items: [], has_more: true, page_token } }; } } } } } });
    await expect(service.listUsers()).rejects.toThrow("群聊分页不完整"); expect(calls).toBeLessThanOrEqual(2);
  }
});
