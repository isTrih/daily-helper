import { expect, spyOn, test } from "bun:test";
import { chromium } from "playwright-core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A2Base, A2Service, A2_GAMES, a2Dates, browserCookies, authSchema, parseA2 } from "../src/a2-service.ts";

const response = { status: 0, data: { profile: [{ title: "a2", cover_num: "2633119", count_average: "10395316", industry_avg: "3244622" }] } };
const cookie = { name: "test", value: "fixture", domain: ".oceanengine.com", path: "/", secure: true, httpOnly: true, expires: -1, sameSite: "Lax" as const };
const auth = { cookies: [cookie], requests: A2_GAMES.map(game => ({ url: `https://yuntu.oceanengine.com/yuntu_ng/api/v1/get_audience_asset_profile?aadvid=${game.aid}&brand_id=123&industry_id=22` })) };
test("北京时间跨月 T-2/T-3", () => {
  expect(a2Dates(new Date("2026-11-30T16:01:00Z"))).toEqual({ day: "2026-12-01", dates: ["2026-11-29", "2026-11-28"] });
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
test("五游戏十行、并发及重启去重、次日再次回补", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-test-"));
  const rows: unknown[] = []; const urls: string[] = []; let attempts = 0;
  const launch = spyOn(chromium, "launch").mockResolvedValue({
    newContext: async () => ({ addCookies: async () => {}, newPage: async () => ({
      url: () => "https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution", goto: async () => {}, waitForTimeout: async () => {}, close: async () => {},
      evaluate: async (_fn: unknown, request: {url: string}) => { urls.push(request.url); if (attempts++ === 0) throw Error("transient read failure"); return response; },
    }) }), close: async () => {},
  } as never);
  const upsert = spyOn(A2Base.prototype, "upsert").mockImplementation(async (...row) => { rows.push(row); });
  const options = { token: "test", dir, appId:"test", appSecret:"test", wikiToken:"test", executablePath:"test" };
  try {
    const service = new A2Service(options); await service.upload(auth);
    const now = new Date("2026-11-16T01:00:00Z");
    await Promise.all([service.run(now), service.run(now)]);
    expect(rows.length).toBe(10);
    await new A2Service(options).run(now); expect(rows.length).toBe(10);
    await service.run(new Date("2026-11-17T01:00:00Z")); expect(rows.length).toBe(20); expect(attempts).toBe(21);
    expect(urls.every(u => !u.includes("_signature") && !u.includes("X-Bogus"))).toBe(true);
    expect(rows[0]).toEqual(["战火勋章", "2026-11-14", { A2:2633119, other_A2:10395316 }]);
  } finally { launch.mockRestore(); upsert.mockRestore(); await rm(dir,{recursive:true,force:true}); }
});
test("部分失败只重试未完成游戏，缺登录态记录可查看状态", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-retry-"));
  const launch = spyOn(chromium, "launch").mockResolvedValue({ newContext:async () => ({addCookies:async()=>{},newPage:async()=>({url:()=>"https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution",goto:async()=>{},waitForTimeout:async()=>{},close:async()=>{},evaluate:async()=>response})}),close:async()=>{} } as never);
  let fail = true; let count = 0;
  const upsert = spyOn(A2Base.prototype,"upsert").mockImplementation(async name => { if(fail && name === "万龙觉醒") throw Error("sensitive-fixture"); count++; });
  try {
    const service = new A2Service({token:"test",dir,appId:"test",appSecret:"test",wikiToken:"test",executablePath:"test"});
    const now = new Date("2026-11-16T01:00:00Z");
    await expect(service.run(now)).rejects.toThrow("缺少登录态");
    expect((await service.status()).errors).toHaveLength(1);
    await service.upload(auth);
    await expect(service.run(now)).rejects.toThrow("万龙觉醒：飞书多维表写入失败");
    expect((await service.status()).errors).toEqual(["万龙觉醒：飞书多维表写入失败"]);
    expect(count).toBe(8);
    fail=false; await service.run(now); expect(count).toBe(10);
    expect((await service.status()).completedDay).toBe("2026-11-16");
  } finally {launch.mockRestore();upsert.mockRestore();await rm(dir,{recursive:true,force:true});}
});
test("采集状态区分云图 HTTP 401 和未捕获的游戏模板", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-auth-status-"));
  const launch = spyOn(chromium, "launch").mockResolvedValue({
    newContext: async () => ({ addCookies: async () => {}, newPage: async () => ({
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
    await rm(dir, { recursive: true, force: true });
  }
});
test("失效页面会重开，单日读取耗尽重试后仍处理同一游戏的另一天", async () => {
  const dir = await mkdtemp(join(tmpdir(), "a2-browser-recovery-"));
  const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  const writes: string[] = [];
  let pageCount = 0;
  let firstDateAttempts = 0;
  const launch = spyOn(chromium, "launch").mockResolvedValue({
    newContext: async () => ({ addCookies: async () => {}, newPage: async () => {
      const pageNumber = ++pageCount;
      let closed = false;
      return {
        url: () => "https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution",
        goto: async () => {}, isClosed: () => closed,
        waitForTimeout: async () => { if (closed) throw Error("Target page, context or browser has been closed"); },
        close: async () => { closed = true; },
        evaluate: async (_fn: unknown, request: {url: string}) => {
          if (new URL(request.url).searchParams.get("date") !== "20261121") return response;
          firstDateAttempts++;
          if (pageNumber === 1) {
            closed = true;
            throw Error("Target page, context or browser has been closed");
          }
          throw Error("page.evaluate: TypeError: Failed to fetch");
        },
      };
    }}), close: async () => {},
  } as never);
  const upsert = spyOn(A2Base.prototype, "upsert").mockImplementation(async (_name, date) => { writes.push(date); });
  try {
    const service = new A2Service({ token: "test", dir, appId: "test", appSecret: "test", wikiToken: "test", executablePath: "test" });
    await service.upload({ ...auth, requests: auth.requests.slice(0, 1) });
    await expect(service.run(new Date("2026-11-23T11:00:00Z"))).rejects.toThrow();
    expect(pageCount).toBe(2);
    expect(firstDateAttempts).toBe(3);
    expect(writes).toEqual(["2026-11-20"]);
    expect((await service.status()).errors[0]).toContain("云图网络请求失败");
  } finally {
    upsert.mockRestore();
    launch.mockRestore();
    sleep.mockRestore();
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
    else if(u.pathname.endsWith("/records") && !u.searchParams.has("page_token")) data={items:[],has_more:true,page_token:"second"};
    else if(u.pathname.endsWith("/records")) data={items:[{record_id:"row",fields:{日期:Date.parse("2026-11-14T00:00:00+08:00")}}],has_more:false};
    return Response.json({code:0,data});
  }) as typeof fetch);
  try {
    const sink = new A2Base("id","secret","wiki");
    await expect(sink.upsert("万龙觉醒","2026-11-14",parseA2(response))).rejects.toThrow("99991672");
    await sink.upsert("万龙觉醒","2026-11-14",parseA2(response));
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
