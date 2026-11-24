import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplicationLogStore, installApplicationLogger } from "../src/application-log.ts";

test("小时轮转跨月，重启和空闲清理只移除超期应用日志", async () => {
  const dir = await mkdtemp(join(tmpdir(), "app-log-"));
  try {
    const store = createApplicationLogStore(dir);
    store.append(new Date("2026-11-29T23:48:00Z"), "info", "已超期");
    store.append(new Date("2026-11-30T00:01:00Z"), "warn", "边界内");
    store.append(new Date("2026-12-01T23:58:00Z"), "error", "当天日志");
    await writeFile(join(dir, "other.log"), "保留");
    expect((await readdir(dir)).sort()).toEqual(["app-2026-11-30T00.log", "app-2026-12-01T23.log", "other.log"]);
    const reopened = createApplicationLogStore(dir);
    reopened.prune(new Date("2026-12-02T00:00:00Z"));
    expect((await readdir(dir)).sort()).toEqual(["app-2026-12-01T23.log", "other.log"]);
    reopened.append(new Date("2026-12-02T00:01:00Z"), "info", "换小时");
    expect(await readFile(join(dir, "app-2026-12-02T00.log"), "utf8")).toBe("2026-12-02T00:01:00.000Z [INFO] 换小时\n");
    reopened.prune(new Date("2026-12-04T00:00:00Z"));
    expect(await readdir(dir)).toEqual(["other.log"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("应用日志记录错误和堆栈，移除凭证、原始对象和 URL 查询", async () => {
  const dir = await mkdtemp(join(tmpdir(), "app-log-redact-"));
  const stop = installApplicationLogger(dir, ["configured-fixture", "11"]);
  try {
    console.error("[a2] 读取失败", new Error("configured-fixture"), { cookies: [{ value: "object-fixture" }] });
    console.warn("请求 https://user:password@example.com/status?arg=query-fixture Cookie: sessionid=cookie-fixture");
    console.log("Authorization: Bearer bearer-fixture");
    console.error("[a2] run_id=11111111-1111-4111-8111-111111111111 stage=cloud_request date=2026-11-22 code=network_error net_error=ERR_CONNECTION_RESET");
    console.log("standalone 11");
    const files = await readdir(dir);
    const output = (await Promise.all(files.map(file => readFile(join(dir, file), "utf8")))).join("");
    expect(output).toContain("[ERROR] [a2] 读取失败 Error: [REDACTED]");
    expect(output).toContain("application-log.test.ts");
    expect(output).toContain("https://example.com/status");
    expect(output).toContain("run_id=11111111-1111-4111-8111-111111111111 stage=cloud_request date=2026-11-22");
    expect(output).toContain("standalone [REDACTED]");
    for (const value of ["configured-fixture", "object-fixture", "query-fixture", "cookie-fixture", "bearer-fixture", "user:password"]) {
      expect(output).not.toContain(value);
    }
  } finally {
    stop();
    await rm(dir, { recursive: true, force: true });
  }
});
