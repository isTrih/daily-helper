import { describe, expect, test } from "bun:test";
import { LarkService } from "../src/lark-service.ts";

function serviceWithClient(client: object): LarkService {
  const im = (client as { im?: { v1: { chat?: unknown } } }).im;
  if (im && !im.v1.chat) im.v1.chat = {
    get: async () => ({ code: 0, data: { chat_mode: "p2p" } }),
  };
  const service = new LarkService("test_app", "test_secret");
  Object.defineProperty(service, "client", { value: client });
  return service;
}

describe("LarkService CardKit 卡片", () => {
  for (const existing of [[], ["db9g11bb"], ["db9g11bb", "da5da1g1"]]) {
    test(`群聊发送前补齐成员：已有 ${existing.length} 人，支持分页`, async () => {
      const calls: string[] = [];
      let invited: string[] = [];
      const service = serviceWithClient({
        im: { v1: {
          chat: { get: async () => ({ code: 0, data: { chat_mode: "group" } }) },
          chatMembers: {
            get: async ({ params }: { params: { page_token?: string } }) => {
              calls.push("members");
              return { code: 0, data: params.page_token
                ? { items: existing.map(member_id => ({ member_id })), has_more: false }
                : { items: [], has_more: true, page_token: "next" } };
            },
            create: async ({ data, params }: { data: { id_list: string[] }; params: { member_id_type: string } }) => {
              expect(params.member_id_type).toBe("user_id");
              invited = data.id_list;
              calls.push("invite");
              return { code: 0, data: {} };
            },
          },
          message: { create: async () => {
            calls.push("send");
            return { code: 0, data: { message_id: "om_group" } };
          } },
        } },
        cardkit: { v1: { card: { create: async () => {
          calls.push("card");
          return { code: 0, data: { card_id: "card_group" } };
        } } } },
      });
      await service.sendCard("oc_group", { schema: "2.0" });
      expect(invited).toEqual(["db9g11bb", "da5da1g1"].filter(id => !existing.includes(id)));
      expect(calls).toEqual(["members", "members", ...(existing.length < 2 ? ["invite"] : []), "card", "send"]);
    });
  }

  test("拉群待审批或失败时不发送卡片", async () => {
    for (const result of [
      { code: 123, msg: "forbidden" },
      { code: 0, data: { pending_approval_id_list: ["db9g11bb"] } },
      { code: 0, data: { invalid_id_list: ["db9g11bb"] } },
    ]) {
      const service = serviceWithClient({ im: { v1: {
        chat: { get: async () => ({ code: 0, data: { chat_mode: "group" } }) },
        chatMembers: {
          get: async () => ({ code: 0, data: { items: [], has_more: false } }),
          create: async () => result,
        },
      } } });
      await expect(service.sendCard("oc_group", { schema: "2.0" })).rejects.toThrow(/邀请|未能全部加入/);
    }
  });

  test("先创建卡片实体再通过 card_id 发送并更新", async () => {
    let createPayload: unknown;
    let messagePayload: unknown;
    let updatePayload: unknown;
    let convertCalls = 0;
    const client = {
      cardkit: {
        v1: {
          card: {
            create: async (payload: unknown) => {
              createPayload = payload;
              return { code: 0, msg: "success", data: { card_id: "card_123" } };
            },
            update: async (payload: unknown) => {
              updatePayload = payload;
              return { code: 0, msg: "success", data: {} };
            },
            idConvert: async () => {
              convertCalls += 1;
              return { code: 0, msg: "success", data: { card_id: "unexpected" } };
            },
          },
        },
      },
      im: {
        v1: {
          message: {
            create: async (payload: unknown) => {
              messagePayload = payload;
              return { code: 0, msg: "success", data: { message_id: "om_123" } };
            },
          },
        },
      },
    };
    const service = serviceWithClient(client);
    const card = { schema: "2.0", config: { update_multi: true } };

    expect(await service.sendCard("oc_123", card)).toBe("om_123");
    expect(createPayload).toEqual({ data: { type: "card_json", data: JSON.stringify(card) } });
    const messageContent = JSON.parse((messagePayload as { data: { content: string } }).data.content);
    expect(messageContent).toEqual({ type: "card", data: { card_id: "card_123" } });

    const updatedCard = { schema: "2.0", body: { elements: [] } };
    await service.updateCard("om_123", updatedCard);
    expect(convertCalls).toBe(0);
    expect(updatePayload).toEqual({
      path: { card_id: "card_123" },
      data: {
        card: { type: "card_json", data: JSON.stringify(updatedCard) },
        sequence: expect.any(Number),
      },
    });
  });

  test("服务重启后可从消息 ID 转换卡片实体 ID", async () => {
    let convertedMessageId = "";
    let updatedCardId = "";
    const client = {
      cardkit: {
        v1: {
          card: {
            idConvert: async (payload: { data: { message_id: string } }) => {
              convertedMessageId = payload.data.message_id;
              return { code: 0, msg: "success", data: { card_id: "card_legacy" } };
            },
            update: async (payload: { path: { card_id: string } }) => {
              updatedCardId = payload.path.card_id;
              return { code: 0, msg: "success", data: {} };
            },
          },
        },
      },
    };
    const service = serviceWithClient(client);

    await service.updateCard("om_legacy", { schema: "2.0" });
    expect(convertedMessageId).toBe("om_legacy");
    expect(updatedCardId).toBe("card_legacy");
  });

  test("卡片更新序列号使用秒级整数并保持单调递增", async () => {
    const sequences: number[] = [];
    const client = {
      cardkit: {
        v1: {
          card: {
            idConvert: async () => ({ code: 0, msg: "success", data: { card_id: "card_sequence" } }),
            update: async (payload: { data: { sequence: number } }) => {
              sequences.push(payload.data.sequence);
              return { code: 0, msg: "success", data: {} };
            },
          },
        },
      },
    };
    const service = serviceWithClient(client);

    await service.updateCard("om_sequence", { schema: "2.0" });
    await service.updateCard("om_sequence", { schema: "2.0" });

    expect(sequences).toHaveLength(2);
    expect(Number.isSafeInteger(sequences[0])).toBe(true);
    expect(sequences[0]!).toBeLessThanOrEqual(2_147_483_647);
    expect(sequences[1]).toBe(sequences[0]! + 1);
  });

  test("飞书 HTTP 错误只保留错误码和文案", async () => {
    const client = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ code: 0, msg: "success", data: { card_id: "card_error" } }),
          },
        },
      },
      im: {
        v1: {
          message: {
            create: async () => {
              throw {
                message: "Request failed with status code 400",
                config: { headers: { Authorization: "Bearer must_not_leak" } },
                response: { data: { code: 230001, msg: "invalid card content" } },
              };
            },
          },
        },
      },
    };
    const service = serviceWithClient(client);

    let message = "";
    try {
      await service.sendCard("oc_error", { schema: "2.0" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("向会话 oc_error 发送卡片失败：230001 invalid card content");
    expect(message).not.toContain("must_not_leak");
  });
});

test("用户ID发送绕过群成员检查，使用open_id且仍可更新原卡片", async () => {
  let payload: any; let updates = 0;
  const service = serviceWithClient({
    im: { v1: { chat: { get: async () => { throw Error("must not inspect private recipients"); } }, message: { create: async (value: unknown) => { payload = value; return { code: 0, data: { message_id: "om_private" } }; } } } },
    cardkit: { v1: { card: { create: async () => ({ code: 0, data: { card_id: "card_private" } }), update: async () => { updates++; return { code: 0 }; } } } },
  });
  await service.sendCard({ type: "user", id: "ou_private" }, { schema: "2.0" });
  expect(payload.params.receive_id_type).toBe("open_id"); expect(payload.data.receive_id).toBe("ou_private");
  await service.updateCard("om_private", { schema: "2.0" }); expect(updates).toBe(1);
});
