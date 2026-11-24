import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type BrowserContext, type Page, type Request as BrowserRequest, type Response as BrowserResponse } from "playwright-core";
import { z } from "zod";

export const A2_GAMES = [
  { code: "w", name: "战火勋章", aid: "1753459094831118" },
  { code: "d1", name: "小冰冰传奇", aid: "1775180790896781" },
  { code: "rok", name: "万国觉醒", aid: "1715399349333006" },
  { code: "samo", name: "万龙觉醒", aid: "1793391127052291" },
  { code: "pgame", name: "塔塔冒险队", aid: "1870863252827667" },
] as const;
export const A2_CLOUD_TIMEOUT_MS = 60_000;
const cookieSchema = z.strictObject({
  name: z.string().min(1), value: z.string(), domain: z.string().refine(v => v === "oceanengine.com" || v.endsWith(".oceanengine.com")),
  path: z.string().startsWith("/"), secure: z.boolean(), httpOnly: z.boolean(),
  expires: z.number(), sameSite: z.enum(["Strict", "Lax", "None"]),
});
export const authSchema = z.strictObject({
  cookies: z.array(cookieSchema).min(1).max(300),
  requests: z.array(z.strictObject({ url: z.string().url().refine(value => {
    const u = new URL(value);
    const keys = [...u.searchParams.keys()];
    return u.origin === "https://yuntu.oceanengine.com" && !u.username && !u.password && !u.hash &&
      /^\/yuntu_ng\/api\/v1\/get_audience_asset_(profile|trend)$/.test(u.pathname) &&
      A2_GAMES.some(game => game.aid === u.searchParams.get("aadvid")) &&
      /^\d+$/.test(u.searchParams.get("brand_id") ?? "") &&
      keys.every(key => ["aadvid", "brand_id", "industry_id"].includes(key)) && new Set(keys).size === keys.length &&
      (!u.searchParams.has("industry_id") || u.searchParams.get("industry_id") === "22");
  }), headers: z.partialRecord(z.enum(["x-industry-version", "x-path-id"]), z.string().max(512).refine(value => !/[\r\n]/.test(value))).default({}) })).min(1).max(5).refine(requests => new Set(requests.map(request => new URL(request.url).searchParams.get("aadvid"))).size === requests.length),
});
type Auth = z.infer<typeof authSchema>;
// Restore the same session token under the name required by get_user.
export function browserCookies(cookies: Auth["cookies"]): Auth["cookies"] {
  const result = cookies.map(cookie => ({ ...cookie }));
  for (const source of cookies.filter(cookie => cookie.name === "sessionid_ss")) {
    if (!result.some(cookie => cookie.name === "sessionid" && cookie.domain === source.domain && cookie.path === source.path)) {
      result.push({ ...source, name: "sessionid", sameSite: "Lax" });
    }
  }
  return result;
}
// Only fixed diagnostics and numeric upstream status codes should leave the collector.
export class A2CollectionError extends Error {}

class A2FeishuError extends Error {
  constructor(response: Response, code?: unknown) {
    const apiCode = typeof code === "number" || typeof code === "string" ? String(code) : "";
    super(`飞书 A2 操作失败 (${apiCode !== "0" && /^\d{1,12}$/.test(apiCode) ? apiCode : response.status})`);
    this.httpStatus = response.status;
    const logId = response.headers.get("x-tt-logid");
    this.logId = logId && /^[A-Za-z0-9-]{1,64}$/.test(logId) ? logId : undefined;
  }

  readonly httpStatus: number;
  readonly logId: string | undefined;
}

function feishuDetails(error: unknown) {
  return error instanceof A2FeishuError
    ? ` http_status=${error.httpStatus} feishu_log_id=${error.logId ?? "none"}`
    : "";
}

function pageInterruption(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  if (/page crashed/i.test(error.message)) return "云图采集页面崩溃";
  if (error.name === "TargetClosedError" || /Target page, context or browser has been closed/i.test(error.message)) {
    return "云图采集页面或浏览器连接已关闭";
  }
  if (/Execution context was destroyed|Cannot find context with specified id|Frame was detached/i.test(error.message)) {
    return "云图采集页面在请求期间跳转或重载";
  }
}

function collectionError(error: unknown, fallback: string): string {
  if (error instanceof A2CollectionError) return error.message;
  const message = error instanceof Error ? error.message : "";
  const interrupted = pageInterruption(error);
  if (interrupted) return interrupted;
  const feishu = /飞书 A2 操作失败 \((\d+)\)/.exec(message);
  if (feishu) return feishu[1] === "99991672"
    ? "飞书应用缺少接口权限（99991672），请检查 Wiki 与多维表格权限"
    : `飞书接口错误（${feishu[1]}）`;
  if (/^云图返回错误（业务状态 -?\d+）$/.test(message) ||
      /^云图缺少有效 A2 数值（(?:profile|A2|other_A2)）$/.test(message) ||
      message === "缺少游戏请求模板，请访问该游戏的云图人群资产页并重新上传" ||
      message === "云图登录未恢复，请重新上传登录态" ||
      message === "云图缺少有效 A2 数值" ||
      message === "云图返回错误，请重新上传登录态" ||
      message === "A2 超出整数范围") return message;
  const httpStatus = /云图 HTTP 请求失败（(\d{3})）/.exec(message);
  if (httpStatus?.[1] === "401") return "云图登录未恢复（HTTP 401），请重新登录并上传登录态";
  if (httpStatus) return `云图 HTTP 请求失败（${httpStatus[1]}）`;
  if (message.includes("云图请求超时")) return `云图请求超时（${A2_CLOUD_TIMEOUT_MS / 1000} 秒）`;
  if (message.includes("云图响应不是有效 JSON")) return "云图响应不是有效 JSON";
  const networkCode = /\bnet::(ERR_[A-Z_]+)\b/.exec(message);
  if (networkCode) return `云图网络请求失败（${networkCode[1]}）`;
  if (/Failed to fetch|NetworkError when attempting to fetch|Load failed/i.test(message)) return "云图网络请求失败（浏览器未收到响应）";
  if (/\b(?:TimeoutError|AbortError)\b|Timeout \d+ms exceeded/i.test(message)) return `${fallback}（超时）`;
  return fallback;
}

function failureCode(error: unknown, reason: string) {
  if (/登录未恢复|缺少登录态/.test(reason)) return "auth_required";
  if (reason.includes("请求模板")) return "template_missing";
  if (reason.includes("超时")) return "timeout";
  if (pageInterruption(error)) return "page_interrupted";
  if (/HTTP \d{3}/.test(reason)) return "http_error";
  if (reason.includes("网络请求失败")) return "network_error";
  if (reason.includes("JSON")) return "invalid_json";
  if (/缺少有效 A2|超出整数范围/.test(reason)) return "invalid_metrics";
  if (reason.includes("云图返回错误")) return "upstream_rejected";
  if (/飞书.*(?:错误|权限)/.test(reason)) return "feishu_api_error";
  return "unclassified";
}

export function a2ErrorDetails(error: unknown, reason: string) {
  return `code=${failureCode(error, reason)}${feishuDetails(error)}`;
}
const beijingDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });

export function a2Dates(now = new Date()) {
  const day = beijingDate.format(now);
  const offset = (n: number) => new Date(Date.parse(`${day}T00:00:00+08:00`) - n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  return { day, dates: [offset(2), offset(3)] };
}

function missingDates(existing: readonly string[], through: string) {
  const dates = new Set(existing);
  const start = [...dates].sort()[0] ?? through;
  const first = Date.parse(start);
  const missing: string[] = [];
  for (let time = Date.parse(through); time >= first; time -= 86_400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (!dates.has(date)) missing.push(date);
  }
  return missing;
}

function a2Debug(enabled: boolean | undefined, message: string) {
  if (enabled !== false) console.debug(`[debug] ${message}`);
}

export function createA2Trace(runId: string, enabled: boolean | undefined, component = "a2") {
  const prefix = `[${component}] run_id=${runId}`;
  return {
    debug: (message: string) => a2Debug(enabled, `${prefix} ${message}`),
    info: (message: string) => console.info(`${prefix} ${message}`),
    error: (message: string) => console.error(`${prefix} ${message}`),
  };
}
export function parseA2(payload: any): { A2: number; other_A2: number } {
  if (payload?.status !== undefined && payload.status !== 0 && payload.status !== "success") {
    const status = payload.status;
    throw new Error(Number.isSafeInteger(status) ? `云图返回错误（业务状态 ${status}）` : "云图返回错误，请重新上传登录态");
  }
  const profile = payload?.data?.profile;
  const row = Array.isArray(profile) ? profile.find(p => p?.title === "a2") : undefined;
  if (!row) throw new Error("云图缺少有效 A2 数值（profile）");
  const integer = (value: unknown, field: "A2" | "other_A2") => {
    if (!(typeof value === "number" || typeof value === "string" && /^\d+$/.test(value))) throw new Error(`云图缺少有效 A2 数值（${field}）`);
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("A2 超出整数范围");
    return n;
  };
  return { A2: integer(row.cover_num, "A2"), other_A2: integer(row.count_average, "other_A2") };
}

async function closeCollectionPage(page: Page | undefined, trace: ReturnType<typeof createA2Trace>) {
  try { await page?.close(); }
  catch { trace.debug("stage=page_cleanup 无法关闭采集页面，采集浏览器将在本轮结束后关闭"); }
}

async function openCollectionPage(context: BrowserContext, game: typeof A2_GAMES[number], trace: ReturnType<typeof createA2Trace>) {
  const started = performance.now();
  trace.debug(`stage=navigation game=${game.code} ${game.name} 正在打开云图人群资产页面（导航超时 ${A2_CLOUD_TIMEOUT_MS / 1000} 秒）`);
  const page = await context.newPage();
  try {
    const navigation = await page.goto(`https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution?aadvid=${game.aid}`, { waitUntil: "domcontentloaded", timeout: A2_CLOUD_TIMEOUT_MS });
    if (navigation && navigation.status() >= 400) throw new Error(`云图 HTTP 请求失败（${navigation.status()}）`);
    // Let the cloud page initialize its own request middleware.
    await page.waitForTimeout(3000);
    if (new URL(page.url()).pathname.startsWith("/account/login")) throw new A2CollectionError("云图登录未恢复，请重新上传登录态");
    trace.debug(`stage=navigation game=${game.code} http_status=${navigation?.status() ?? "unknown"} duration_ms=${Math.round(performance.now() - started)} ${game.name} 云图人群资产页面已就绪`);
    return page;
  } catch (error) {
    await closeCollectionPage(page, trace);
    throw error;
  }
}

type CloudRequestTrace = {
  requests: number;
  status?: number;
  contentType?: "json" | "html" | "other" | "missing";
  networkError?: string;
};

function watchCloudRequest(page: Page, url: string) {
  const target = new URL(url);
  const details: CloudRequestTrace = { requests: 0 };
  const matches = (request: BrowserRequest) => {
    const observed = new URL(request.url());
    return observed.origin === target.origin && observed.pathname === target.pathname &&
      ["aadvid", "brand_id", "date"].every(key => observed.searchParams.get(key) === target.searchParams.get(key));
  };
  const onRequest = (request: BrowserRequest) => {
    if (matches(request)) details.requests++;
  };
  const onResponse = (response: BrowserResponse) => {
    if (!matches(response.request())) return;
    details.status = response.status();
    const contentType = response.headers()["content-type"]?.toLowerCase();
    details.contentType = !contentType ? "missing" : contentType.includes("json") ? "json" : contentType.includes("html") ? "html" : "other";
  };
  const onFailure = (request: BrowserRequest) => {
    if (matches(request)) details.networkError = /\b(?:ERR|NS_ERROR)_[A-Z0-9_]+\b/.exec(request.failure()?.errorText ?? "")?.[0] ?? "unknown";
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onFailure);
  return () => {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onFailure);
    return `requests_seen=${details.requests} http_status=${details.status ?? "none"} content_type=${details.contentType ?? "none"} net_error=${details.networkError ?? "none"}`;
  };
}

export async function readA2CloudJson(page: Page, url: string, headers: Record<string, string>, report?: (details: string) => void) {
  const stop = report ? watchCloudRequest(page, url) : undefined;
  try {
    return await page.evaluate(async ({ url, headers, timeoutMs }) => {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetch(url, { headers, credentials: "include", signal });
        if (!response.ok) throw new Error(`云图 HTTP 请求失败（${response.status}）`);
        return await response.json();
      } catch (error) {
        if (signal.aborted) throw new Error("云图请求超时");
        if (error instanceof SyntaxError) throw new Error("云图响应不是有效 JSON");
        throw error;
      }
    }, { url, headers, timeoutMs: A2_CLOUD_TIMEOUT_MS });
  } finally {
    if (report && stop) report(stop());
  }
}
export async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}
async function load(path: string): Promise<any> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error: any) { if (error.code === "ENOENT") return {}; throw error; }
}

// Calls are serialized in this single-process service, including uploads and daily runs.
export class A2Service {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private options: { token: string; dir: string; appId: string; appSecret: string; wikiToken: string; executablePath: string; debug?: boolean }) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next;
  }
  upload(input: unknown) {
    const auth = authSchema.parse(input);
    return this.serial(async () => {
      const aids = [...new Set(auth.requests.map(r => new URL(r.url).searchParams.get("aadvid")))];
      if (aids.some(aid => !A2_GAMES.some(game => game.aid === aid))) throw new Error("登录态包含未配置游戏");
      await atomicJson(`${this.options.dir}/auth.json`, auth);
      console.info(`[a2] 登录态上传成功，覆盖 ${aids.length}/${A2_GAMES.length} 款游戏`);
      return { games: aids, uploadedAt: new Date().toISOString() };
    });
  }
  async status() {
    const state = await load(`${this.options.dir}/state.json`);
    const auth = await load(`${this.options.dir}/auth.json`);
    const history = await load(`${this.options.dir}/history/status.json`);
    return { ...state, history, hasAuth: !!auth.cookies, capturedGames: auth.requests?.map((r: any) => new URL(r.url).searchParams.get("aadvid")) ?? [] };
  }
  backfill(start: string, end?: string) {
    return this.serial(async () => {
      const { backfillA2 } = await import("./a2-history.ts");
      return backfillA2(this.options, start, end);
    });
  }
  run(now = new Date(), { refreshLatest = false, runId = crypto.randomUUID() }: { refreshLatest?: boolean; runId?: string } = {}) {
    return this.serial(() => this.collect(now, refreshLatest, runId));
  }
  private async collect(now: Date, refreshLatest: boolean, runId: string) {
    const { day, dates } = a2Dates(now);
    const through = dates[0]!;
    const trace = createA2Trace(runId, this.options.debug);
    const { debug } = trace;
    const started = performance.now();
    const path = `${this.options.dir}/state.json`;
    const state = await load(path).catch(() => {
      const reason = "无法读取本地采集状态文件";
      trace.error(`stage=state_read code=state_read_failed ${reason}`);
      throw new A2CollectionError(reason);
    });
    if (state.completedDay === day && state.coverageThrough === through) {
      debug(`${day} 有完成记录，本次仍以飞书现有日期核对缺口`);
    }
    trace.info(`stage=start mode=${refreshLatest ? "manual_refresh" : "daily"} day=${day} through=${through} 开始采集`);
    const errors: string[] = [];
    const sink = new A2Base(this.options.appId, this.options.appSecret, this.options.wikiToken);
    const plans = new Map<typeof A2_GAMES[number], string[]>();
    for (const game of A2_GAMES) {
      const scope = `stage=feishu_dates game=${game.code}`;
      const stageStarted = performance.now();
      debug(`${scope} ${game.name} 开始分页读取飞书已有日期`);
      try {
        const existing = (await sink.listDailyDates(game.name)).filter(date => date <= through);
        const gaps = missingDates(existing, through);
        const pending = refreshLatest && gaps[0] !== through ? [through, ...gaps] : gaps;
        debug(`${scope} duration_ms=${Math.round(performance.now() - stageStarted)} ${game.name} 飞书在截止日期及以前已有 ${existing.length} 天（${existing[0] ?? "空表"} 至 ${existing.at(-1) ?? "空表"}），待${refreshLatest ? "采集" : "补"} ${pending.length} 天${pending.length ? `：${pending.join("、")}` : ""}`);
        if (pending.length) plans.set(game, pending);
      } catch (error) {
        const reason = collectionError(error, "读取飞书已有日期失败");
        errors.push(`${game.name}：${reason}`);
        trace.error(`${scope} ${a2ErrorDetails(error, reason)} duration_ms=${Math.round(performance.now() - stageStarted)} ${game.name}：${reason}`);
      }
    }
    let written = 0;
    if (plans.size > 0) {
      let browserStage = "auth_read";
      let browserFailure = "无法读取云图登录态，请检查登录态文件";
      try {
        debug("开始校验云图登录态");
        const parsedAuth = authSchema.safeParse(await load(`${this.options.dir}/auth.json`));
        if (!parsedAuth.success) throw new A2CollectionError("缺少登录态，请通过插件上传");
        const auth = parsedAuth.data;
        debug(`登录态格式校验通过，覆盖 ${auth.requests.length}/${A2_GAMES.length} 款游戏，启动采集浏览器`);
        browserStage = "browser_launch";
        browserFailure = "无法启动采集浏览器，请检查 CHROMIUM_PATH";
        const browser = await chromium.launch({ executablePath: this.options.executablePath, headless: true, args: ["--disable-dev-shm-usage", ...(process.env.CHROMIUM_NO_SANDBOX === "true" ? ["--no-sandbox"] : [])] });
        try {
          browserStage = "browser_context";
          browserFailure = "无法初始化采集浏览器或载入登录态，请重新上传登录态后再试";
          const context = await browser.newContext();
          await context.addCookies(browserCookies(auth.cookies));
          debug("采集浏览器已就绪，已载入登录态");
          for (const [game, plannedDates] of plans) {
            let stage = "template";
            let stageStarted = performance.now();
            let failure = "读取云图 A2 数据失败";
            let activeDate: string | undefined;
            let page: Page | undefined;
            try {
              const template = auth.requests.find(r => new URL(r.url).searchParams.get("aadvid") === game.aid);
              if (!template) throw new Error("缺少游戏请求模板，请访问该游戏的云图人群资产页并重新上传");
              for (const date of plannedDates) {
                const key = `${game.code}:${date}`;
                activeDate = date;
                const scope = `game=${game.code} date=${date}`;
                stage = "cloud_request";
                stageStarted = performance.now();
                failure = "读取云图 A2 数据失败";
                const u = new URL(template.url);
                u.pathname = "/yuntu_ng/api/v1/get_audience_asset_profile";
                for (const k of [...u.searchParams.keys()]) if (!["aadvid", "brand_id", "industry_id"].includes(k)) u.searchParams.delete(k);
                if (!u.searchParams.get("brand_id")) throw new Error("捕获请求缺少 brand_id");
                u.searchParams.set("date", date!.replaceAll("-", ""));
                let values: ReturnType<typeof parseA2> | undefined;
                let reason = failure;
                let diagnostics = "";
                for (let attempt = 1; attempt <= 3; attempt++) {
                  let attemptStarted = performance.now();
                  let network = "";
                  stage = page ? "cloud_request" : "navigation";
                  try {
                    page ??= await openCollectionPage(context, game, trace);
                    stage = "cloud_request";
                    attemptStarted = performance.now();
                    debug(`stage=${stage} ${scope} attempt=${attempt}/3 timeout_ms=${A2_CLOUD_TIMEOUT_MS} ${game.name} 正在读取云图 A2 数据`);
                    const payload = await readA2CloudJson(page, u.href, template.headers, details => { network = details; });
                    stage = "cloud_metrics";
                    values = parseA2(payload);
                    debug(`stage=${stage} ${scope} attempt=${attempt}/3 duration_ms=${Math.round(performance.now() - attemptStarted)} ${network} ${game.name} 读取成功`);
                    break;
                  } catch (error) {
                    reason = collectionError(error, page ? failure : "打开云图人群资产页面失败");
                    diagnostics = `stage=${stage} ${scope} attempt=${attempt}/3 ${a2ErrorDetails(error, reason)} duration_ms=${Math.round(performance.now() - attemptStarted)} ${network}`;
                    debug(`${diagnostics} ${game.name}：${reason}`);
                    if (page && pageInterruption(error)) {
                      debug(`${game.name} ${date} 当前页面失效，将关闭并在下次尝试时重新打开`);
                      await closeCollectionPage(page, trace);
                      page = undefined;
                    }
                    if (attempt === 3 || reason.startsWith("云图登录未恢复")) break;
                    debug(`${game.name} ${date} 等待 ${attempt} 秒后重试`);
                    await Bun.sleep(1000 * attempt);
                  }
                }
                if (!values) {
                  errors.push(`${game.name} ${date}：${reason}`);
                  trace.error(`${diagnostics} ${game.name}：${reason}`);
                  if (reason.startsWith("云图登录未恢复")) break;
                  continue;
                }
                try {
                  stage = "feishu_write";
                  stageStarted = performance.now();
                  const createOnly = !refreshLatest || date !== through;
                  debug(`stage=${stage} ${scope} policy=${createOnly ? "insert_missing" : "refresh_latest"} ${game.name} 开始写入飞书多维表`);
                  failure = "飞书多维表写入失败";
                  const action = await sink.upsert(game.name, date, values, { createOnly });
                  if (action !== "already_exists") written++;
                  debug(`stage=${stage} ${scope} action=${action} duration_ms=${Math.round(performance.now() - stageStarted)} ${game.name} 写入处理完成`);
                  if (state.day !== day) { state.day = day; state.done = []; }
                  state.done ??= [];
                  if (!state.done.includes(key)) state.done.push(key);
                  stage = "state_write";
                  stageStarted = performance.now();
                  failure = "保存采集进度失败";
                  await atomicJson(path, state);
                  debug(`stage=${stage} ${scope} duration_ms=${Math.round(performance.now() - stageStarted)} ${game.name} 进度已保存`);
                } catch (error) {
                  const reason = collectionError(error, failure);
                  errors.push(`${game.name} ${date}：${reason}`);
                  trace.error(`stage=${stage} ${scope} ${a2ErrorDetails(error, reason)} duration_ms=${Math.round(performance.now() - stageStarted)} ${game.name}：${reason}`);
                }
              }
            } catch (error) {
              const reason = collectionError(error, failure);
              errors.push(`${game.name}：${reason}`);
              trace.error(`stage=${stage} game=${game.code}${activeDate ? ` date=${activeDate}` : ""} ${a2ErrorDetails(error, reason)} duration_ms=${Math.round(performance.now() - stageStarted)} ${game.name}：${reason}`);
            } finally {
              await closeCollectionPage(page, trace);
            }
          }
          browserStage = "browser_close";
          browserFailure = "关闭采集浏览器失败";
        } finally {
          debug("关闭采集浏览器");
          await browser.close();
        }
      } catch (error) {
        const reason = collectionError(error, browserFailure);
        errors.push(reason);
        trace.error(`stage=${browserStage} ${a2ErrorDetails(error, reason)} ${reason}`);
      }
    } else {
      debug("没有待补日期，无需启动云图采集浏览器");
    }
    state.lastRunAt = now.toISOString(); state.lastRunId = runId; state.errors = errors;
    if (!errors.length) { state.completedDay = day; state.coverageThrough = through; }
    else if (state.completedDay === day) delete state.coverageThrough;
    debug("保存本轮采集状态");
    await atomicJson(path, state).catch(() => {
      const reason = "无法保存本地采集状态文件";
      trace.error(`stage=state_write code=state_write_failed ${reason}`);
      throw new A2CollectionError(reason);
    });
    trace.info(`stage=finish result=${errors.length ? "error" : "success"} day=${day} through=${through} pending=${[...plans.values()].reduce((count, pending) => count + pending.length, 0)} written=${written} failures=${errors.length} duration_ms=${Math.round(performance.now() - started)} 采集结束`);
    if (errors.length) throw new A2CollectionError(errors.join("；"));
  }
}

export class A2Base {
  private token = "";
  private tokenExpiresAt = 0;
  private base = "";
  constructor(private appId: string, private secret: string, private wiki: string) {}
  private async api(path: string, method = "GET", data?: unknown): Promise<any> {
    const response = await fetch(`https://open.feishu.cn/open-apis/${path}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => { throw new A2FeishuError(response); }) as any;
    if (!response.ok || result?.code !== 0) throw new A2FeishuError(response, result?.code);
    return result.data;
  }
  private async items(path: string, key: string): Promise<any[]> {
    const items: any[] = []; let cursor = "";
    const seen = new Set<string>();
    do {
      const result = await this.api(`${path}${path.includes("?") ? "&" : "?"}page_size=100${cursor ? `&page_token=${encodeURIComponent(cursor)}` : ""}`);
      items.push(...result[key] ?? []);
      cursor = result.has_more ? result.page_token : "";
      if (result.has_more && (!cursor || seen.has(cursor))) throw new Error("飞书分页游标缺失或重复");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  }
  private async baseRoot(): Promise<string> {
    if (!this.token || Date.now() >= this.tokenExpiresAt) {
      const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.secret }), signal: AbortSignal.timeout(30000),
      });
      const result = await response.json().catch(() => { throw new A2FeishuError(response); }) as any;
      if (!response.ok || result?.code !== 0 || !result.tenant_access_token) throw new A2FeishuError(response, result?.code);
      this.token = result.tenant_access_token;
      this.tokenExpiresAt = Date.now() + Math.max(60, Number(result.expire || 7200) - 60) * 1000;
    }
    if (!this.base) {
      const node = await this.api(`wiki/v2/spaces/get_node?token=${encodeURIComponent(this.wiki)}`);
      if (node.node.obj_type !== "bitable") throw new Error("目标 Wiki 必须是多维表格");
      this.base = node.node.obj_token;
    }
    return `bitable/v1/apps/${this.base}/tables`;
  }
  private async gameRecords(name: string) {
    const root = await this.baseRoot();
    const table = (await this.items(root, "items")).find(table => table.name === name);
    return table ? this.items(`${root}/${table.table_id}/records`, "items") : undefined;
  }
  async listDailyDates(name: string): Promise<string[]> {
    const dates = new Set<string>();
    for (const row of await this.gameRecords(name) ?? []) {
      const timestamp = row.fields?.["日期"];
      if (typeof timestamp !== "number") continue;
      const date = new Date(timestamp);
      if (!Number.isNaN(date.getTime())) dates.add(beijingDate.format(date));
    }
    return [...dates].sort();
  }
  async readDaily(name: string): Promise<Array<{ date: string; A2: number; other_A2: number }>> {
    const rows = await this.gameRecords(name);
    if (!rows) throw new Error(`${name}暂无 A2 数据表`);
    const index = new Map<string, { date: string; A2: number; other_A2: number }>();
    for (const row of rows) {
      if (typeof row.fields?.["日期"] !== "number") continue;
      const date = a2Dates(new Date(row.fields["日期"])).day;
      if (index.has(date)) throw new Error(`${name}的 ${date} 存在重复数据`);
      index.set(date, { date, ...parseA2({ data: { profile: [{ title: "a2", cover_num: row.fields.A2, count_average: row.fields.other_A2 }] } }) });
    }
    return [...index.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  private async tableRoot(name: string): Promise<string> {
    const root = await this.baseRoot();
    const tables = await this.items(root, "items");
    let table = tables.find(t => t.name === name);
    if (!table) {
      const created = await this.api(root, "POST", { table: { name, default_view_name: "日维度 A2", fields: [
        { field_name: "日期", type: 5, property: { date_formatter: "yyyy-MM-dd", auto_fill: false } },
        { field_name: "A2", type: 2, property: { formatter: "1,000" } },
        { field_name: "other_A2", type: 2, property: { formatter: "1,000" } },
        { field_name: "游戏", type: 1 },
      ] } });
      table = { table_id: created.table_id };
    }
    const tableRoot = `${root}/${table.table_id}`;
    const fields = await this.items(`${tableRoot}/fields`, "items");
    const gameField = fields.find(f => f.field_name === "游戏");
    if (!gameField) await this.api(`${tableRoot}/fields`, "POST", { field_name: "游戏", type: 1 });
    else if (gameField.type !== 1) throw new Error("游戏列必须为文本字段");
    if (!fields.some(f => f.field_name === "日期" && f.type === 5)) throw new Error("现有表字段不符合日期/A2类型");
    if (!fields.some(f => f.field_name === "A2")) await this.api(`${tableRoot}/fields`, "POST", { field_name: "A2", type: 2, property: { formatter: "1,000" } });
    else if (!fields.some(f => f.field_name === "A2" && f.type === 2)) throw new Error("现有表字段不符合日期/A2类型");
    if (!fields.some(f => f.field_name === "other_A2")) await this.api(`${tableRoot}/fields`, "POST", { field_name: "other_A2", type: 2, property: { formatter: "1,000" } });
    else if (!fields.some(f => f.field_name === "other_A2" && f.type === 2)) throw new Error("other_A2 必须为数字字段");
    for (const field of fields.filter(f => ["A2", "other_A2"].includes(f.field_name))) {
      if (field.property?.formatter !== "1,000") await this.api(`${tableRoot}/fields/${field.field_id}`, "PUT", { field_name: field.field_name, type: 2, property: { formatter: "1,000" } });
    }
    return tableRoot;
  }
  async upsert(name: string, date: string, a2: { A2: number; other_A2: number }, { createOnly = false } = {}): Promise<"created" | "updated" | "already_exists"> {
    const tableRoot = await this.tableRoot(name);
    const timestamp = Date.parse(`${date}T00:00:00+08:00`);
    const rows = await this.items(`${tableRoot}/records`, "items");
    const matches = rows.filter(r => {
      const value = r.fields?.["日期"];
      return typeof value === "number" && a2Dates(new Date(value)).day === date;
    });
    if (matches.length > 1) throw new Error("日期存在重复记录，请先合并");
    if (matches[0] && createOnly) return "already_exists";
    const fieldsValue = { 日期: timestamp, ...a2, 游戏: name };
    if (matches[0]) {
      await this.api(`${tableRoot}/records/${matches[0].record_id}`, "PUT", { fields: fieldsValue });
      return "updated";
    }
    await this.api(`${tableRoot}/records`, "POST", { fields: fieldsValue });
    return "created";
  }
  async upsertMany(name: string, input: Array<{ date: string; A2: number; other_A2: number }>) {
    const tableRoot = await this.tableRoot(name);
    const existing = await this.items(`${tableRoot}/records`, "items");
    const index = new Map<string, string>();
    const wanted = new Set(input.map(row => row.date));
    if (wanted.size !== input.length) throw new Error("待写入日期重复");
    for (const row of existing) {
      if (typeof row.fields?.["日期"] !== "number") continue;
      const date = a2Dates(new Date(row.fields["日期"])).day;
      if (!wanted.has(date)) continue;
      if (index.has(date)) throw new Error(`日期 ${date} 存在重复记录，请先合并`);
      index.set(date, row.record_id);
    }
    const creates: any[] = [], updates: any[] = [];
    for (const row of input) {
      const record = { fields: { 日期: Date.parse(`${row.date}T00:00:00+08:00`), A2: row.A2, other_A2: row.other_A2, 游戏: name } };
      const id = index.get(row.date);
      if (id) updates.push({ record_id: id, ...record });
      else creates.push(record);
    }
    for (const [action, records] of [["batch_create", creates], ["batch_update", updates]] as const) {
      for (let offset = 0; offset < records.length; offset += 100) {
        await this.api(`${tableRoot}/records/${action}`, "POST", { records: records.slice(offset, offset + 100) });
      }
    }
    // Verify the full requested range against a paginated read-back, including values.
    const actual = new Map<string, any>();
    for (const row of await this.items(`${tableRoot}/records`, "items")) {
      if (typeof row.fields?.["日期"] !== "number") continue;
      const date = a2Dates(new Date(row.fields["日期"])).day;
      if (!wanted.has(date)) continue;
      if (actual.has(date)) throw new Error(`写入后日期 ${date} 重复`);
      actual.set(date, row.fields);
    }
    for (const row of input) {
      const fields = actual.get(row.date);
      // Bitable returns numeric fields as decimal strings on some Base versions.
      const number = (value: unknown) => typeof value === "number" || typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
      if (!fields || number(fields.A2) !== row.A2 || number(fields.other_A2) !== row.other_A2 || fields["游戏"] !== name) throw new Error(`日期 ${row.date} 写入核验失败`);
    }
    return { created: creates.length, updated: updates.length, verified: input.length };
  }
  async populateGame(name: string) {
    const root = await this.tableRoot(name);
    const before = await this.items(`${root}/records`, "items");
    const updates = before.filter(row => row.fields?.["游戏"] !== name)
      .map(row => ({ record_id: row.record_id, fields: { 游戏: name } }));
    for (let offset = 0; offset < updates.length; offset += 100) {
      await this.api(`${root}/records/batch_update`, "POST", { records: updates.slice(offset, offset + 100) });
    }
    const after = await this.items(`${root}/records`, "items");
    const index = new Map(after.map(row => [row.record_id, row.fields]));
    if (before.length !== after.length || index.size !== after.length) throw new Error("游戏列回填后记录数量不一致");
    for (const row of before) {
      const fields = index.get(row.record_id);
      if (!fields || fields["游戏"] !== name || fields["日期"] !== row.fields["日期"] ||
        String(fields.A2) !== String(row.fields.A2) || String(fields.other_A2) !== String(row.fields.other_A2)) {
        throw new Error("游戏列回填核验失败，原日期及指标必须保持一致");
      }
    }
    return { updated: updates.length, verified: after.length };
  }
}
