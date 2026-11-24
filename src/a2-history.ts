import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { z } from "zod";
import { A2Base, A2_GAMES, a2Dates, a2Debug, atomicJson, authSchema, browserCookies, parseA2 } from "./a2-service.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "无效日期");
export const historyInput = z.object({ start: isoDate.default("2026-01-01"), end: isoDate.optional() });
export type A2HistoryRow = { date: string; A2: number; other_A2: number };
function shift(date: string, n: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
export function historyWindows(start: string, end: string) {
  isoDate.parse(start); isoDate.parse(end);
  if (start > end || Date.parse(end) - Date.parse(start) > 3660 * 86400000) throw new Error("历史日期范围无效");
  const windows: Array<{ start: string; end: string }> = [];
  for (let from = start; from <= end;) {
    const to = shift(from, 89) < end ? shift(from, 89) : end;
    windows.push({ start: from, end: to }); from = shift(to, 1);
  }
  return windows;
}
export function parseTrend(payload: any, start: string, end: string): A2HistoryRow[] {
  if (payload?.status !== 0 || payload?.data?.BaseResp?.StatusCode && payload.data.BaseResp.StatusCode !== 0 || !Array.isArray(payload?.data?.trend_points)) throw new Error("云图历史趋势返回错误");
  const rows = new Map<string, A2HistoryRow>();
  for (const point of payload.data.trend_points) {
    const date = isoDate.parse(point.date);
    if (date < start || date > end) continue;
    if (rows.has(date)) throw new Error(`云图历史日期重复：${date}`);
    rows.set(date, { date, ...parseA2({ status: 0, data: { profile: [{ ...point, title: "a2" }] } }) });
  }
  for (let date = start; date <= end; date = shift(date, 1)) {
    if (!rows.has(date)) throw new Error(`云图历史缺少日期 ${date}，不会补零`);
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}
type Options = { dir: string; appId: string; appSecret: string; wikiToken: string; executablePath: string; debug?: boolean };
export async function backfillA2(options: Options, start: string, end = a2Dates().dates[0]!) {
  if (end > a2Dates().dates[0]!) throw new Error("历史结束日期不能晚于北京时间 T−2");
  const windows = historyWindows(start, end);
  const debug = (message: string) => a2Debug(options.debug, `[a2-history] ${message}`);
  debug(`开始历史回填 ${start} 至 ${end}，共 ${windows.length} 个请求窗口`);
  const auth = authSchema.parse(JSON.parse(await readFile(`${options.dir}/auth.json`, "utf8")));
  const folder = `${options.dir}/history/${start}_${end}`;
  const status: any = { start, end, startedAt: new Date().toISOString(), status: "running", counts: {}, errors: [] };
  const persist = () => atomicJson(`${options.dir}/history/status.json`, status);
  await persist();
  let browser;
  try {
    debug("启动采集浏览器并载入登录态");
    browser = await chromium.launch({ executablePath: options.executablePath, headless: true, args: ["--disable-dev-shm-usage", ...(process.env.CHROMIUM_NO_SANDBOX === "true" ? ["--no-sandbox"] : [])] });
    const context = await browser.newContext();
    await context.addCookies(browserCookies(auth.cookies));
    const sink = new A2Base(options.appId, options.appSecret, options.wikiToken);
    for (const game of A2_GAMES) {
      status.game = game.name; await persist();
      let page;
      try {
        const template = auth.requests.find(request => new URL(request.url).searchParams.get("aadvid") === game.aid);
        if (!template) throw new Error("缺少游戏请求模板");
        let cache: { rows: A2HistoryRow[]; windows: string[] } = { rows: [], windows: [] };
        const cachePath = `${folder}/${game.code}.json`;
        try { cache = JSON.parse(await readFile(cachePath, "utf8")); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
        const points = new Map(cache.rows.map(row => [row.date, row]));
        debug(`${game.name} 已读取历史缓存，覆盖 ${cache.windows.length}/${windows.length} 个窗口`);
        if (windows.some(window => !cache.windows.includes(window.end))) {
          debug(`${game.name} 正在打开云图人群资产页面`);
          page = await context.newPage();
          await page.goto(`https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution?aadvid=${game.aid}`, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForTimeout(4000);
          if (new URL(page.url()).pathname.startsWith("/account/login")) throw new Error("登录态失效");
          for (const window of windows) {
            if (cache.windows.includes(window.end)) continue;
            debug(`${game.name} 请求 ${window.start} 至 ${window.end} 的历史趋势`);
            const u = new URL(template.url);
            u.pathname = "/yuntu_ng/api/v1/get_audience_asset_trend";
            for (const key of [...u.searchParams.keys()]) if (!["aadvid", "brand_id", "industry_id"].includes(key)) u.searchParams.delete(key);
            if (!u.searchParams.get("brand_id")) throw new Error("请求模板缺少 brand_id");
            u.searchParams.set("date", window.end.replaceAll("-", ""));
            u.searchParams.set("card", "2"); u.searchParams.set("benchmark", "1");
            const payload = await page.evaluate(async ({ url, headers }) => {
              const response = await fetch(url, { headers, credentials: "include", signal: AbortSignal.timeout(30000) });
              if (!response.ok) throw new Error("历史接口 HTTP 错误");
              return response.json();
            }, { url: u.href, headers: template.headers });
            for (const row of parseTrend(payload, window.start, window.end)) points.set(row.date, row);
            cache.rows = [...points.values()].sort((a, b) => a.date.localeCompare(b.date)); cache.windows.push(window.end);
            await atomicJson(cachePath, cache);
            status.counts[game.code] = { fetched: cache.rows.length }; await persist();
            debug(`${game.name} 已校验并缓存 ${window.start} 至 ${window.end}，累计 ${cache.rows.length} 天`);
          }
        }
        const expected = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
        if (cache.rows.length !== expected) throw new Error("缓存日期数量不完整");
        debug(`${game.name} 正在向飞书写入并读回核验 ${cache.rows.length} 天`);
        const result = await sink.upsertMany(game.name, cache.rows);
        status.counts[game.code] = { fetched: cache.rows.length, ...result }; await persist();
        console.info(`[a2-history] ${game.name} 飞书核验通过 ${result.verified} 天`);
      } catch (error) {
        // Only known application errors; never print browser diagnostics carrying request details.
        const message = error instanceof Error ? error.message : "";
        const safe = /^(云图历史|飞书 A2 操作失败|日期 |缓存日期|登录态|缺少游戏|请求模板|现有表|other_A2)/.test(message) ? message : "历史采集或写入失败，请检查权限与登录态";
        status.errors.push(`${game.name}：${safe}`); await persist();
        console.error(`[a2-history] ${game.name}：${safe}`);
      } finally { await page?.close(); }
    }
    status.status = status.errors.length ? "error" : "success";
    status.finishedAt = new Date().toISOString(); delete status.game; await persist();
    return status;
  } catch {
    status.status = "error"; status.errors.push("历史任务启动失败，请检查浏览器与登录态"); await persist();
    return status;
  } finally { await browser?.close(); }
}
