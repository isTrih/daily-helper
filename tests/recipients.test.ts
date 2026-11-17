import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverRecipients, scheduleRecipients, recipientsSchema } from "../src/recipients.ts";
import { deliveryScheduleInputSchema, ScheduleService } from "../src/schedule-service.ts";

import { startServer } from "../src/server.ts";
import { readConfig } from "../src/config.ts";

const targets = [{ type: "chat" as const, id: "oc_group" }, { type: "user" as const, id: "ou_user" }];

test("收件人类型校验、旧群计划兼容和多目标去重", () => {
  expect(scheduleRecipients({ chatId: "legacy" })).toEqual([{ type: "chat", id: "legacy" }]);
  expect(scheduleRecipients({ recipients: [...targets, ...targets], chatId: "ignored" })).toEqual(targets);
  expect(() => recipientsSchema.parse([{ type: "user", id: "oc_group" }])).toThrow();
  expect(() => recipientsSchema.parse([{ type: "chat", id: "ou_user" }])).toThrow();
  expect(() => deliveryScheduleInputSchema.parse({ name: "empty", time: "09:00", request: {} })).toThrow();
});

test("重启保留混合收件人；旧计划编辑迁移；失败不阻断其他目标并记录失败", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recipients-"));
  const file = join(dir, "plans.json");
  const delivered: string[] = [];
  const runner = async (schedule: Parameters<typeof scheduleRecipients>[0]) => deliverRecipients(scheduleRecipients(schedule), async target => {
    delivered.push(target.id); if (target.type === "chat") throw Error("group unavailable");
  });
  const service = new ScheduleService(file, "Asia/Shanghai", runner);
  const reloaded = new ScheduleService(file, "Asia/Shanghai", runner);
  try {
    await service.initialize();
    const old = await service.create({ name: "legacy", chatId: "oc_old", time: "23:59", enabled: false, request: {} });
    await service.update(old.id, { name: "mixed", recipients: targets, time: "23:59", enabled: true, request: { a2GameCodes: ["rok"] } });
    service.stop(); await reloaded.initialize();
    expect(reloaded.list()[0]!.recipients).toEqual(targets);
    expect(reloaded.list()[0]!.chatId).toBeUndefined();
    expect(reloaded.list()[0]!.nextRunAt).toBeDefined();
    await (reloaded as unknown as { execute(id: string): Promise<void> }).execute(old.id);
    expect(delivered).toEqual(["oc_group", "ou_user"]);
    expect(reloaded.list()[0]!.lastStatus).toBe("error");
    expect(reloaded.list()[0]!.lastError).toContain("1/2");
    await reloaded.update(old.id, { name: "legacy client", chatId: "oc_new", time: "23:59", enabled: false, request: {} });
    expect(scheduleRecipients(reloaded.list()[0]!)).toEqual([{ type: "chat", id: "oc_new" }]);
  } finally { service.stop(); reloaded.stop(); await rm(dir, { recursive: true, force: true }); }
});

test("普通和A2计划API均接受群聊加私聊，分别持久化且发送参数正确", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recipient-api-"));
  const ordinary = new ScheduleService(join(dir, "daily.json"), "Asia/Shanghai", async () => {});
  const a2 = new ScheduleService(join(dir, "a2.json"), "Asia/Shanghai", async () => {});
  const sends: unknown[] = [];
  const server = startServer({ config: { ...readConfig({ INTERNAL_API_TOKEN: "fixture", HOST: "127.0.0.1" }), port: 0 }, reportService: {} as never,
    orchestrator: { send: async (request: unknown) => { sends.push(request); return { messageCount: 2 }; } } as never,
    a2Reports: { send: async (codes: string[], recipients: unknown) => { sends.push({ codes, recipients }); return { messageCount: 2 }; } } as never,
    larkService: { listUsers: async () => ({ users: [{ id: "ou_user", name: "用户" }], warning: "" }) } as never,
    scheduleService: ordinary, a2Schedules: a2,
  });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (path: string, data: unknown, method = "POST") => fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  try {
    const plan = { name: "mixed", recipients: targets, time: "09:10", enabled: false };
    expect((await post("/api/schedules", { ...plan, request: {} })).status).toBe(201);
    expect((await post("/api/a2/reports/schedules", { ...plan, gameCodes: ["rok"] })).status).toBe(200);
    expect(ordinary.list()).toHaveLength(1); expect(a2.list()).toHaveLength(1);
    expect(a2.list()[0]!.request.a2GameCodes).toEqual(["rok"]);
    expect(ordinary.list()[0]!.request.a2GameCodes).toBeUndefined();
    expect((await post("/api/reports/send", { recipients: targets })).status).toBe(200);
    expect((await post("/api/a2/reports/send", { recipients: targets, gameCodes: ["rok"] })).status).toBe(200);
    expect((sends[0] as any).recipients).toEqual(targets); expect((sends[1] as any).recipients).toEqual(targets);
    expect((await post("/api/schedules", { ...plan, recipients: [{ type: "user", id: "oc_invalid" }], request: {} })).status).toBe(400);
    expect((await post("/api/a2/reports/schedules", { ...plan, recipients: [], gameCodes: ["rok"] })).status).toBe(400);
    expect((await fetch(base + "/recipients.js")).status).toBe(200);
    expect((await (await fetch(base + "/api/recipients/users")).json() as any).users[0].id).toBe("ou_user");
  } finally { server.stop(true); ordinary.stop(); a2.stop(); await rm(dir, { recursive: true, force: true }); }
});
