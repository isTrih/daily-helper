import { expect, spyOn, test } from "bun:test";
import { chromium } from "playwright-core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A2Base, A2Service, A2_GAMES, a2Dates, browserCookies, authSchema, parseA2, readA2CloudJson } from "../src/a2-service.ts";

const response = { status: 0, data: { profile: [{ title: "a2", cover_num: "2633119", count_average: "10395316", industry_avg: "3244622" }] } };
const cookie = { name: "test", value: "fixture", domain: ".oceanengine.com", path: "/", secure: true, httpOnly: true, expires: -1, sameSite: "Lax" as const };
const auth = { cookies: [cookie], requests: A2_GAMES.map(game => ({ url: `https://yuntu.oceanengine.com/yuntu_ng/api/v1/get_audience_asset_profile?aadvid=${game.aid}&brand_id=123&industry_id=22` })) };
const pageEvents = { on() {}, off() {} };

function trendPayload(request: { url: string }, days = 2) {
  const url = new URL(request.url);
  expect(url.pathname).toBe("/yuntu_ng/api/v1/get_audience_asset_trend");
  expect(url.searchParams.get("card")).toBe("2");
  expect(url.searchParams.get("benchmark")).toBe("1");
  const date = url.searchParams.get("date")!;
  const end = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`);
  return { status: 0, data: { trend_points: Array.from({ length: days }, (_, offset) => ({
    ...response.data.profile[0]!, date: new Date(end - offset * 86_400_000).toISOString().slice(0, 10),
  })) } };
}
test("北京时间跨月 T-2/T-3", () => {
  expect(a2Dates(new Date("2026-11-30T16:01:00Z"))).toEqual({ day: "2026-12-01", dates: ["2026-11-29", "2026-11-28"] });
});
test("云图单次请求给 60 秒，读取响应体超时与 JSON 错误分开记录", async () => {
  const controller = new AbortController();
  const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const page = { evaluate: (evaluate: Function, args: unknown) => evaluate(args) } as never;
  const url = "https://yuntu.oceanengine.com/yuntu_ng/api/v1/get_audience_asset_profile";
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation((async (_input, options) => {
    expect(options?.signal).toBe(controller.signal);
    return new Response("invalid-json");
  }) as typeof fetch);
  try {
    await expect(readA2CloudJson(page, url, {})).rejects.toThrow("云图响应不是有效 JSON");
    expect(timeout).toHaveBeenCalledWith(60_000);
    const response = new Response();
    response.json = async () => {
      controller.abort();
      throw new DOMException("Reading aborted", "AbortError");
    };
    fetchMock.mockResolvedValue(response);
    await expect(readA2CloudJson(page, url, {})).rejects.toThrow("云图请求超时");
  } finally {
    fetchMock.mockRestore();
    timeout.mockRestore();
  }
});
test("云图网络日志只记录匹配请求的状态、内容类型和网络错误码", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const url = auth.requests[0]!.url + "&date=20261122";
  const pathnameFixture = "fixture-param";
  const request = { url: () => url + "&signature=" + pathnameFixture, failure: () => ({ errorText: "net::ERR_CONNECTION_RESET " + pathnameFixture }) };
  const page = {
    on: (event: string, listener: (value: unknown) => void) => listeners.set(event, listener),
    off: (event: string) => listeners.delete(event),
    evaluate: async () => {
      listeners.get("request")!({ url: () => url.replace("20261122", "20261121") });
      listeners.get("request")!(request);
      listeners.get("response")!({ request: () => request, status: () => 503, headers: () => ({ "content-type": "text/html; " + pathnameFixture }) });
      listeners.get("requestfailed")!(request);
      throw new TypeError("Failed to fetch");
    },
  } as never;
  let trace = "";
  await expect(readA2CloudJson(page, url, {}, detail => { trace = detail; })).rejects.toThrow("Failed to fetch");
  expect(trace).toBe("requests_seen=1 http_status=503 content_type=html net_error=ERR_CONNECTION_RESET");
  expect(trace).not.toContain(pathnameFixture);
  expect(listeners.size).toBe(0);
});
test("HAR 数字字符串解析，其他品牌取 count_average", () => {
  expect(parseA2(response)).toEqual({ A2: 2633119, other_A2: 10395316 });
  expect(() => parseA2({ status: 1, data: response.data })).toThrow();
  for (const value of [null, undefined, "", "1.5", "-1", "9007199254740992"]) {
    expect(() => parseA2({data:{profile:[{title:"a2", cover_num:value, count_average:"1"}]}})).toThrow();
  }
  expect(parseA2({data:{profile:[{title:"a2", cover_num:"0", count_average:"0"}]}})).toEqual({A2:0,other_A2:0});
});
test("登录态仅允许云图只读接口及 Oceanengine cookies", () => {
  expect(authSchema.safeParse(auth).success).toBe(true);
  expect(authSchema.safeParse({...auth, cookies:[{...cookie,domain:"evil-oceanengine.com"}]}).success).toBe(false);
  expect(authSchema.safeParse({...auth, requests:[{url:"https://example.com/api"}]}).success).toBe(false);
});
test("五游戏缺口、并发及重启去重、次日只补新增缺口", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-test-"));
  const rows: unknown[] = []; const urls: string[] = []; let attempts = 0;
  const launch = spyOn(chromium, "launch").mockResolvedValue({
    newContext: async () => ({ addCookies: async () => {}, newPage: async () => ({
      ...pageEvents,
      url: () => "https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution", goto: async () => {}, waitForTimeout: async () => {}, close: async () => {},
      evaluate: async (_fn: unknown, request: {url: string}) => { urls.push(request.url); if (attempts++ === 0) throw Error("transient read failure"); return trendPayload(request); },
    }) }), close: async () => {},
  } as never);
  const tableDates = new Map<string, string[]>(A2_GAMES.map(game => [game.name, ["2026-11-12"]]));
  const listDates = spyOn(A2Base.prototype, "listDailyDates").mockImplementation(async name => tableDates.get(name)!);
  const upsert = spyOn(A2Base.prototype, "upsertMany").mockImplementation(async (game, batch) => {
    for (const { date, ...values } of batch) {
      rows.push([game, date, values]);
      tableDates.get(game)!.push(date);
    }
    return { created: batch.length, updated: 0, verified: batch.length };
  });
  const options = { token: "test", dir, appId:"test", appSecret:"test", wikiToken:"test", executablePath:"test" };
  try {
    const service = new A2Service(options); await service.upload(auth);
    const now = new Date("2026-11-16T01:00:00Z");
    await Promise.all([service.run(now), service.run(now)]);
    expect(rows.length).toBe(10);
    await new A2Service(options).run(now); expect(rows.length).toBe(10);
    await service.run(new Date("2026-11-17T01:00:00Z")); expect(rows.length).toBe(15); expect(attempts).toBe(11);
    expect(urls.every(u => !u.includes("_signature") && !u.includes("X-Bogus"))).toBe(true);
    expect(rows[0]).toEqual(["战火勋章", "2026-11-14", { A2:2633119, other_A2:10395316 }]);
  } finally { launch.mockRestore(); upsert.mockRestore(); listDates.mockRestore(); await rm(dir,{recursive:true,force:true}); }
});
test("部分失败只重试未完成游戏，缺登录态记录可查看状态", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-retry-"));
  const launch = spyOn(chromium, "launch").mockResolvedValue({ newContext:async () => ({addCookies:async()=>{},newPage:async()=>({...pageEvents,url:()=>"https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution",goto:async()=>{},waitForTimeout:async()=>{},close:async()=>{},evaluate:async(_fn: unknown, request: {url: string})=>trendPayload(request)})}),close:async()=>{} } as never);
  let fail = true; let count = 0;
  const tableDates = new Map<string, string[]>(A2_GAMES.map(game => [game.name, ["2026-11-12"]]));
  const listDates = spyOn(A2Base.prototype, "listDailyDates").mockImplementation(async name => tableDates.get(name)!);
  const upsert = spyOn(A2Base.prototype,"upsertMany").mockImplementation(async (name, batch) => {
    if(fail && name === "万龙觉醒") throw Error("sensitive-fixture");
    tableDates.get(name)!.push(...batch.map(row => row.date));
    count += batch.length;
    return { created: batch.length, updated: 0, verified: batch.length };
  });
  try {
    const service = new A2Service({token:"test",dir,appId:"test",appSecret:"test",wikiToken:"test",executablePath:"test"});
    const now = new Date("2026-11-16T01:00:00Z");
    await expect(service.run(now)).rejects.toThrow("缺少登录态");
    expect((await service.status()).errors).toHaveLength(1);
    await service.upload(auth);
    await expect(service.run(now)).rejects.toThrow("万龙觉醒 截至 2026-11-14 的趋势窗口：飞书多维表批量写入失败");
    expect((await service.status()).errors).toEqual(["万龙觉醒 截至 2026-11-14 的趋势窗口：飞书多维表批量写入失败"]);
    expect(count).toBe(8);
    fail=false; await service.run(now); expect(count).toBe(10);
    expect((await service.status()).completedDay).toBe("2026-11-16");
  } finally {launch.mockRestore();upsert.mockRestore();listDates.mockRestore();await rm(dir,{recursive:true,force:true});}
});
test("采集状态区分云图 HTTP 401 和未捕获的游戏模板", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-auth-status-"));
  const listDates = spyOn(A2Base.prototype, "listDailyDates").mockResolvedValue([]);
  const launch = spyOn(chromium, "launch").mockResolvedValue({
    newContext: async () => ({ addCookies: async () => {}, newPage: async () => ({
      ...pageEvents,
      url: () => "https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution",
      goto: async () => {}, waitForTimeout: async () => {}, close: async () => {},
      evaluate: async () => { throw new Error("page.evaluate: 云图 HTTP 请求失败（401）"); },
    }) }), close: async () => {},
  } as never);
  try {
    const service = new A2Service({ token: "test", dir, appId: "test", appSecret: "test", wikiToken: "test", executablePath: "test" });
    await service.upload({ ...auth, requests: auth.requests.slice(0, 1) });
    await expect(service.run(new Date("2026-11-22T11:00:00Z"))).rejects.toThrow("云图登录未恢复（HTTP 401）");
    expect((await service.status()).errors).toContain("小冰冰传奇：缺少游戏请求模板，请访问该游戏的云图人群资产页并重新上传");
  } finally {
    launch.mockRestore();
    listDates.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});
test("失效页面会重开重试趋势，响应缺一天时仍写同窗口的其他日期", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-browser-recovery-"));
  const listDates = spyOn(A2Base.prototype, "listDailyDates").mockResolvedValue(["2026-11-19"]);
  const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  const writes: string[] = [];
  let pageCount = 0;
  let firstDateAttempts = 0;
  const launch = spyOn(chromium, "launch").mockResolvedValue({
    newContext: async () => ({ addCookies: async () => {}, newPage: async () => {
      const pageNumber = ++pageCount;
      let closed = false;
      return {
        ...pageEvents,
        url: () => "https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution",
        goto: async () => {}, isClosed: () => closed,
        waitForTimeout: async () => { if (closed) throw Error("Target page, context or browser has been closed"); },
        close: async () => { closed = true; },
        evaluate: async (_fn: unknown, request: {url: string}) => {
          firstDateAttempts++;
          if (pageNumber === 1) {
            closed = true;
            throw Error("Target page, context or browser has been closed");
          }
          const trend = trendPayload(request);
          trend.data.trend_points.shift();
          return trend;
        },
      };
    }}), close: async () => {},
  } as never);
  const upsert = spyOn(A2Base.prototype, "upsertMany").mockImplementation(async (_name, batch) => {
    writes.push(...batch.map(row => row.date));
    return { created: batch.length, updated: 0, verified: batch.length };
  });
  try {
    const service = new A2Service({ token: "test", dir, appId: "test", appSecret: "test", wikiToken: "test", executablePath: "test" });
    await service.upload({ ...auth, requests: auth.requests.slice(0, 1) });
    await expect(service.run(new Date("2026-11-23T11:00:00Z"))).rejects.toThrow();
    expect(pageCount).toBe(2);
    expect(firstDateAttempts).toBe(2);
    expect(writes).toEqual(["2026-11-20"]);
    expect((await service.status()).errors[0]).toContain("云图历史缺少日期 2026-11-21");
  } finally {
    upsert.mockRestore();
    launch.mockRestore();
    listDates.mockRestore();
    sleep.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});
test("北京时间 11/24 截止 11/22，按各游戏飞书日期补缺并忽略旧版完成标记", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-gaps-"));
  const tableDates = new Map<string, string[]>([
    ["战火勋章", ["2026-11-18", "2026-11-20", "2026-11-23"]],
    ["小冰冰传奇", ["2026-11-20", "2026-11-22"]],
    ["万国觉醒", []],
    ["万龙觉醒", ["2026-11-22"]],
    ["塔塔冒险队", ["2026-11-22"]],
  ]);
  const requests: string[] = [];
  const writes: string[] = [];
  const listDates = spyOn(A2Base.prototype, "listDailyDates").mockImplementation(async name => tableDates.get(name)!);
  const debug = spyOn(console, "debug").mockImplementation(() => {});
  const launch = spyOn(chromium, "launch").mockResolvedValue({
    newContext: async () => ({ addCookies: async () => {}, newPage: async () => ({
      ...pageEvents,
      url: () => "https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution",
      goto: async () => {}, waitForTimeout: async () => {}, close: async () => {},
      evaluate: async (_fn: unknown, input: {url: string}) => {
        const params = new URL(input.url).searchParams;
        const end = params.get("date")!;
        requests.push(end);
        const game = A2_GAMES.find(game => game.aid === params.get("aadvid"))?.code;
        const days = game === "w" ? (end === "20261122" ? 5 : 3) : game === "d1" && end === "20261122" ? 3 : 1;
        return trendPayload(input, days);
      },
    }) }), close: async () => {},
  } as never);
  const upsert = spyOn(A2Base.prototype, "upsertMany").mockImplementation(async (name, batch) => {
    writes.push(...batch.map(row => `${name}:${row.date}`));
    return { created: batch.length, updated: 0, verified: batch.length };
  });
  const options = { token: "test", dir, appId: "test", appSecret: "test", wikiToken: "test", executablePath: "test" };
  const now = new Date("2026-11-23T16:00:01Z");
  try {
    await writeFile(join(dir, "state.json"), JSON.stringify({ day: "2026-11-24", done: ["w:2026-11-22"], completedDay: "2026-11-24" }));
    const service = new A2Service(options);
    await service.upload(auth);
    await service.run(now);
    expect(requests).toEqual(Array(5).fill("20261122"));
    expect(writes).toEqual([
      "战火勋章:2026-11-22", "战火勋章:2026-11-21", "战火勋章:2026-11-19", "小冰冰传奇:2026-11-21", "万国觉醒:2026-11-22",
    ]);
    const status = await service.status();
    expect(status.coverageThrough).toBe("2026-11-22");
    expect(status.lastRunId).toMatch(/^[a-f0-9-]{36}$/);
    expect(debug.mock.calls.some(([line]) => String(line).includes("待补 3 天：2026-11-22、2026-11-21、2026-11-19"))).toBe(true);
    expect(debug.mock.calls.every(([line]) => String(line).startsWith(`[debug] [a2] run_id=${status.lastRunId} `))).toBe(true);
    debug.mockClear();
    for (const name of tableDates.keys()) tableDates.set(name, ["2026-11-23"]);
    await new A2Service({ ...options, debug: false }).run(new Date("2026-11-24T16:00:01Z"));
    expect(debug.mock.calls).toHaveLength(0);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(listDates).toHaveBeenCalledTimes(10);
    for (const name of tableDates.keys()) tableDates.set(name, ["2026-11-22", "2026-11-23"]);
    tableDates.set("战火勋章", ["2026-11-21", "2026-11-23"]);
    const beforeManual = writes.length;
    await service.run(new Date("2026-11-24T16:00:01Z"), { refreshLatest: true });
    expect(writes.slice(beforeManual)).toEqual([
      "战火勋章:2026-11-23", "战火勋章:2026-11-22", "小冰冰传奇:2026-11-23",
      "万国觉醒:2026-11-23", "万龙觉醒:2026-11-23", "塔塔冒险队:2026-11-23",
    ]);
  } finally {
    upsert.mockRestore();
    launch.mockRestore();
    listDates.mockRestore();
    debug.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});
test("飞书表顺序为 22、21、17 日时批量新增 20、19、18 日，部分写入后只补缺口", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-unordered-dates-"));
  const datetime = (day: string) => Date.parse(`2026-11-${day}T00:00:00+08:00`);
  const rows: Array<{ record_id: string; fields: { 日期: number; A2?: number; other_A2?: number; 游戏?: string } }> =
    ["22", "21", "17"].map(day => ({ record_id: `row-${day}`, fields: { 日期: datetime(day) } }));
  const inserted: number[] = [];
  const attempted: number[] = [];
  let failFirst = true;
  const stub = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? "GET";
    if (path.endsWith("/tenant_access_token/internal")) return Response.json({ code: 0, tenant_access_token: "fixture" });
    if (path.endsWith("/get_node")) return Response.json({ code: 0, data: { node: { obj_type: "bitable", obj_token: "base" } } });
    if (path.endsWith("/tables")) return Response.json({ code: 0, data: { items: A2_GAMES.map(game => ({ name: game.name, table_id: game.code })), has_more: false } });
    if (path.endsWith("/fields")) {
      const items = [
        { field_name: "日期", type: 5 }, { field_name: "游戏", type: 1 },
        ...["A2", "other_A2"].map(field_name => ({ field_name, type: 2, property: { formatter: "1,000" } })),
      ];
      return Response.json({ code: 0, data: { items, has_more: false } });
    }
    if (path.endsWith("/w/records/batch_create") && method === "POST") {
      const batch = JSON.parse(String(init?.body)).records as Array<{ fields: typeof rows[number]["fields"] }>;
      attempted.push(...batch.map(row => row.fields.日期));
      for (const { fields } of failFirst ? batch.slice(1) : batch) {
        inserted.push(fields.日期);
        rows.push({ record_id: `new-${fields.日期}`, fields });
      }
      if (failFirst) { failFirst = false; return Response.json({ code: 503 }, { status: 503 }); }
      return Response.json({ code: 0, data: {} });
    }
    if (path.endsWith("/w/records") && method === "GET") {
      const next = url.searchParams.has("page_token");
      return Response.json({ code: 0, data: { items: next ? rows.slice(2) : rows.slice(0, 2), has_more: !next, page_token: "next" } });
    }
    if (path.endsWith("/records") && method === "GET") {
      return Response.json({ code: 0, data: { items: [{ fields: { 日期: datetime("22") } }], has_more: false } });
    }
    throw Error(`Unexpected Feishu operation: ${method} ${path}`);
  }) as typeof fetch);
  const launch = spyOn(chromium, "launch").mockResolvedValue({
    newContext: async () => ({ addCookies: async () => {}, newPage: async () => ({
      ...pageEvents, url: () => "https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution",
      goto: async () => {}, waitForTimeout: async () => {}, close: async () => {},
      evaluate: async (_fn: unknown, request: { url: string }) =>
        trendPayload(request, new URL(request.url).searchParams.get("aadvid") === A2_GAMES[0].aid ? 6 : 1),
    }) }), close: async () => {},
  } as never);
  try {
    const service = new A2Service({ token: "test", dir, appId: "test", appSecret: "test", wikiToken: "test", executablePath: "test", debug: false });
    const now = new Date("2026-11-24T04:00:00Z");
    await writeFile(join(dir, "state.json"), JSON.stringify({ completedDay: "2026-11-24", coverageThrough: "2026-11-22" }));
    await service.upload(auth);
    await expect(service.run(now)).rejects.toThrow("战火勋章 截至 2026-11-22 的趋势窗口");
    expect(attempted).toEqual(["20", "19", "18"].map(datetime));
    expect(inserted).toEqual(["19", "18"].map(datetime));
    await service.run(now);
    expect(inserted).toEqual(["19", "18", "20"].map(datetime));
    expect(rows.slice(0, 3).map(row => row.fields.日期)).toEqual(["22", "21", "17"].map(datetime));
    await service.run(now);
    expect(launch).toHaveBeenCalledTimes(2);
  } finally {
    launch.mockRestore();
    stub.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("11/26 每日采集只按游戏请求截至 11/24 的趋势，补上响应里的全部有效日期", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-full-trend-"));
  const tables = new Map<string, string[]>(A2_GAMES.map(game => [game.name, ["2026-11-21", "2026-11-24"]]));
  tables.set("塔塔冒险队", []);
  const requests: string[] = [];
  const listDates = spyOn(A2Base.prototype, "listDailyDates").mockImplementation(async name => tables.get(name)!);
  const upsert = spyOn(A2Base.prototype, "upsertMany").mockImplementation(async (name, batch) => {
    tables.get(name)!.push(...batch.map(row => row.date));
    return { created: batch.length, updated: 0, verified: batch.length };
  });
  const launch = spyOn(chromium, "launch").mockResolvedValue({
    newContext: async () => ({ addCookies: async () => {}, newPage: async () => ({
      ...pageEvents, url: () => "https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution",
      goto: async () => {}, waitForTimeout: async () => {}, close: async () => {},
      evaluate: async (_fn: unknown, input: { url: string }) => {
        requests.push(new URL(input.url).searchParams.get("date")!);
        return trendPayload(input, 55);
      },
    }) }), close: async () => {},
  } as never);
  try {
    const service = new A2Service({ token: "test", dir, appId: "test", appSecret: "test", wikiToken: "test", executablePath: "test", debug: false });
    const now = new Date("2026-11-26T02:00:00Z");
    await service.upload(auth);
    await service.run(now);
    expect(requests).toEqual(Array(5).fill("20261124"));
    expect(upsert).toHaveBeenCalledTimes(5);
    for (const [game, rows, options] of upsert.mock.calls) {
      const empty = game === "塔塔冒险队";
      expect(rows).toHaveLength(empty ? 55 : 53);
      expect(rows.at(-1)?.date).toBe("2026-10-01");
      expect(rows.some(row => row.date === "2026-11-24" || row.date === "2026-11-21")).toBe(empty);
      expect(options?.updateDates).toEqual([]);
    }
    await service.run(now);
    expect(requests).toHaveLength(5);
    await service.run(new Date("2026-11-27T02:00:00Z"));
    expect(requests.slice(5)).toEqual(Array(5).fill("20261125"));
    expect(upsert.mock.calls.slice(5).every(([, rows]) => rows.length === 1 && rows[0]?.date === "2026-11-25")).toBe(true);
  } finally {
    launch.mockRestore();
    upsert.mockRestore();
    listDates.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("飞书按日期更新已有行并创建 other_A2 列，分页不丢行", async () => {
  const calls: Array<{path:string,method:string,body:any}> = [];
  let wikiCalls = 0;
  const stub = spyOn(globalThis,"fetch").mockImplementation((async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const u=new URL(String(input)); const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({path:u.pathname+u.search,method:init?.method??"GET",body});
    let data: any = {};
    if(u.pathname.includes("tenant_access_token")) return Response.json({code:0,tenant_access_token:"fixture"});
    if(u.pathname.includes("get_node")) {
      if (++wikiCalls === 1) return Response.json({code:99991672,msg:"fixture scope missing"});
      data={node:{obj_type:"bitable",obj_token:"base"}};
    }
    else if(u.pathname.endsWith("/tables")) data={items:[{name:"万龙觉醒",table_id:"table"}],has_more:false};
    else if(u.pathname.endsWith("/fields")) data=init?.method==="POST" ? {} : {items:[{field_name:"日期",type:5},{field_name:"A2",type:2}],has_more:false};
    else if(u.pathname.endsWith("/records") && !u.searchParams.has("page_token")) data={items:[{fields:{日期:Date.parse("2026-11-12T00:00:00+08:00")}}],has_more:true,page_token:"second"};
    else if(u.pathname.endsWith("/records")) data={items:[{record_id:"row",fields:{日期:Date.parse("2026-11-14T00:00:00+08:00")}}],has_more:false};
    return Response.json({code:0,data});
  }) as typeof fetch);
  try {
    const sink = new A2Base("id","secret","wiki");
    await expect(sink.upsert("万龙觉醒","2026-11-14",parseA2(response))).rejects.toThrow("99991672");
    await sink.upsert("万龙觉醒","2026-11-14",parseA2(response));
    expect(await sink.upsert("万龙觉醒","2026-11-14",parseA2(response), { createOnly: true })).toBe("already_exists");
    expect(calls.filter(c => c.method === "PUT" && c.path.includes("/records/")).length).toBe(1);
    expect(await sink.listDailyDates("万龙觉醒")).toEqual(["2026-11-12", "2026-11-14"]);
    expect(await sink.listDailyDates("没有数据表的游戏")).toEqual([]);
    expect(wikiCalls).toBe(2);
    expect(calls.find(c=>c.method==="PUT"&&c.path.includes("/records/"))?.body.fields).toEqual({日期:1794585600000,A2:2633119,other_A2:10395316,游戏:"万龙觉醒"});
    expect(calls.some(c=>c.method==="POST"&&c.body?.field_name==="other_A2")).toBe(true);
  } finally {stub.mockRestore();}
});

test("仅 sessionid_ss 时恢复相同会话，已有 sessionid 不覆盖", () => {
 const source = [{...cookie,name:"sessionid_ss"}];
 const recovered = browserCookies(source as never);
 expect(recovered.map(c=>c.name)).toEqual(["sessionid_ss","sessionid"]);
 expect(recovered[1]!.value).toBe(source[0]!.value);
 expect(source).toHaveLength(1);
 const existing=[...source,{...cookie,name:"sessionid",value:"existing"}];
 expect(browserCookies(existing as never)).toEqual(existing);
});
