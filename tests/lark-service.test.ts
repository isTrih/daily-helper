import { describe, expect, test } from "bun:test";
import { LarkService } from "../src/lark-service.ts";

function serviceWithClient(client: object): LarkService {
  const service = new LarkService("test_app", "test_secret");
  Object.defineProperty(service, "client", { value: client });
  return service;
}

describe("LarkService CardKit 卡片", () => {
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
    expect(message).toBe("向群聊 oc_error 发送卡片失败：230001 invalid card content");
    expect(message).not.toContain("must_not_leak");
  });
});
