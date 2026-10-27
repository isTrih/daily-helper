import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ScheduleService } from "../src/schedule-service.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ScheduleService", () => {
  test("持久化每个群的日报参数并可在重启后继续读取", async () => {
    const directory = await mkdtemp(join(tmpdir(), "daily-helper-schedules-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "schedules.json");
    const service = new ScheduleService(file, "Asia/Shanghai", async () => {});
    await service.initialize();
    const created = await service.create({
      name: "塔塔项目早报",
      chatId: "oc_topic_group",
      time: "09:30",
      enabled: false,
      request: {
        periodIds: [],
        projectIds: [3],
        mode: "combined",
        rankingMode: "today",
        enableForward: false,
        enableForwardInteraction: false,
        showTrend: true,
        topicKeywords: ["#塔塔万圣捣蛋时刻", "养萌物来塔塔"],
      },
    });

    expect(created.request.topicKeywords).toEqual(["塔塔万圣捣蛋时刻", "养萌物来塔塔"]);
    expect(created.nextRunAt).toBeUndefined();

    const reloaded = new ScheduleService(file, "Asia/Shanghai", async () => {});
    await reloaded.initialize();
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.list()[0]).toMatchObject({
      id: created.id,
      chatId: "oc_topic_group",
      time: "09:30",
      enabled: false,
      request: {
        projectIds: [3],
        periodIds: [],
        showTrend: true,
      },
    });

    expect(await reloaded.delete(created.id)).toBe(true);
    expect(reloaded.list()).toEqual([]);
    service.stop();
    reloaded.stop();
  });
});
