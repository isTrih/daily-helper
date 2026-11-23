import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { z } from "zod";

export const A2_GAMES = [
  { code: "w", name: "战火勋章", aid: "1753459094831118" },
  { code: "d1", name: "小冰冰传奇", aid: "1775180790896781" },
  { code: "rok", name: "万国觉醒", aid: "1715399349333006" },
  { code: "samo", name: "万龙觉醒", aid: "1793391127052291" },
  { code: "pgame", name: "塔塔冒险队", aid: "1870863252827667" },
] as const;
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

function collectionError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  const feishu = /飞书 A2 操作失败 \((\d+)\)/.exec(message);
  if (feishu) return feishu[1] === "99991672"
    ? "飞书应用缺少接口权限（99991672），请检查 Wiki 与多维表格权限"
    : `飞书接口错误（${feishu[1]}）`;
  if (message === "缺少游戏请求模板，请访问该游戏的云图人群资产页并重新上传" ||
      message === "云图登录未恢复，请重新上传登录态" ||
      message === "云图缺少有效 A2 数值" ||
      message === "云图返回错误，请重新上传登录态" ||
      message === "A2 超出整数范围") return message;
  const httpStatus = /云图 HTTP 请求失败（(\d{3})）/.exec(message);
  if (httpStatus?.[1] === "401") return "云图登录未恢复（HTTP 401），请重新登录并上传登录态";
  if (httpStatus) return `云图 HTTP 请求失败（${httpStatus[1]}）`;
  if (message.includes("云图响应不是有效 JSON")) return "云图响应不是有效 JSON";
  if (/\b(?:TimeoutError|AbortError)\b|Timeout \d+ms exceeded/i.test(message)) return `${fallback}（超时）`;
  return fallback;
}
export function a2Dates(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const offset = (n: number) => new Date(Date.parse(`${day}T00:00:00+08:00`) - n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  return { day, dates: [offset(2), offset(3)] };
}
export function parseA2(payload: any): { A2: number; other_A2: number } {
  if (payload?.status !== undefined && payload.status !== 0 && payload.status !== "success") throw new Error("云图返回错误，请重新上传登录态");
  const row = payload?.data?.profile?.find((p: any) => p.title === "a2");
  const integer = (value: unknown) => {
    if (!(typeof value === "number" || typeof value === "string" && /^\d+$/.test(value))) throw new Error("云图缺少有效 A2 数值");
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("A2 超出整数范围");
    return n;
  };
  return { A2: integer(row?.cover_num), other_A2: integer(row?.count_average) };
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
  constructor(private options: { token: string; dir: string; appId: string; appSecret: string; wikiToken: string; executablePath: string }) {}
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
  run(now = new Date()) { return this.serial(() => this.collect(now)); }
  private async collect(now: Date) {
    const { day, dates } = a2Dates(now);
    const started = performance.now();
    const path = `${this.options.dir}/state.json`;
    const state = await load(path);
    if (state.completedDay === day) {
      console.debug(`[a2] ${day} 已完成采集，跳过本次触发`);
      return;
    }
    console.info(`[a2] 开始采集，运行日期 ${day}，目标数据日期 ${dates.join("、")}`);
    const parsedAuth = authSchema.safeParse(await load(`${this.options.dir}/auth.json`));
    if (!parsedAuth.success) {
      state.lastRunAt = now.toISOString(); state.errors = ["缺少登录态，请通过插件上传"];
      await atomicJson(path, state);
      console.error(`[a2] ${state.errors[0]}`);
      throw new A2CollectionError(state.errors[0]);
    }
    const auth = parsedAuth.data;
    const errors: string[] = [];
    let written = 0;
    let skipped = 0;
    let context: BrowserContext | undefined;
    let browserFailure = "无法启动采集浏览器，请检查 CHROMIUM_PATH";
    try {
      const browser = await chromium.launch({ executablePath: this.options.executablePath, headless: true, args: ["--disable-dev-shm-usage", ...(process.env.CHROMIUM_NO_SANDBOX === "true" ? ["--no-sandbox"] : [])] });
      try {
        browserFailure = "无法初始化采集浏览器或载入登录态，请重新上传登录态后再试";
        context = await browser.newContext();
        await context.addCookies(browserCookies(auth.cookies));
        console.debug(`[a2] 采集浏览器已就绪，已读取 ${auth.requests.length} 款游戏的请求模板`);
        const sink = new A2Base(this.options.appId, this.options.appSecret, this.options.wikiToken);
        for (const game of A2_GAMES) {
          if (state.day === day && dates.every(date => state.done?.includes(`${game.code}:${date}`))) {
            skipped += dates.length;
            console.debug(`[a2] ${game.name} 目标日期已写入，跳过`);
            continue;
          }
          let failure = "打开云图人群资产页面失败";
          let activeDate: string | undefined;
          try {
            const template = auth.requests.find(r => new URL(r.url).searchParams.get("aadvid") === game.aid);
            if (!template) throw new Error("缺少游戏请求模板，请访问该游戏的云图人群资产页并重新上传");
            console.debug(`[a2] ${game.name} 正在打开云图人群资产页面`);
            const page = await context.newPage();
            try {
              await page.goto(`https://yuntu.oceanengine.com/yuntu_brand/game/assets/crowd/distribution?aadvid=${game.aid}`, { waitUntil: "domcontentloaded", timeout: 45000 });
              // The original site loads its own request/signing middleware; never reuse stale signatures.
              await page.waitForTimeout(3000);
              if (new URL(page.url()).pathname.startsWith("/account/login")) throw new Error("云图登录未恢复，请重新上传登录态");
              for (const date of dates) {
                const key = `${game.code}:${date}`;
                if (state.day === day && state.done?.includes(key)) {
                  skipped++;
                  console.debug(`[a2] ${game.name} ${date} 已写入，跳过`);
                  continue;
                }
                activeDate = date;
                failure = "读取云图 A2 数据失败";
                console.debug(`[a2] ${game.name} ${date} 正在读取云图 A2 数据`);
                const u = new URL(template.url);
                u.pathname = "/yuntu_ng/api/v1/get_audience_asset_profile";
                for (const k of [...u.searchParams.keys()]) if (!["aadvid", "brand_id", "industry_id"].includes(k)) u.searchParams.delete(k);
                if (!u.searchParams.get("brand_id")) throw new Error("捕获请求缺少 brand_id");
                u.searchParams.set("date", date!.replaceAll("-", ""));
                let values: ReturnType<typeof parseA2> | undefined;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    const payload = await page.evaluate(async ({url, headers}: {url: string; headers: Record<string, string>}) => {
                      const response = await fetch(url, { headers, credentials: "include", signal: AbortSignal.timeout(30000) });
                      if (!response.ok) throw new Error(`云图 HTTP 请求失败（${response.status}）`);
                      try { return await response.json(); }
                      catch { throw new Error("云图响应不是有效 JSON"); }
                    }, {url: u.href, headers: template.headers});
                    values = parseA2(payload); break;
                  } catch (error) {
                    if (attempt === 2) throw error;
                    console.warn(`[a2] ${game.name} ${date} 第 ${attempt + 1}/3 次读取失败：${collectionError(error, failure)}，即将重试`);
                    await page.waitForTimeout(1000 * (attempt + 1));
                  }
                }
                if (!values) throw new Error("云图缺少有效 A2 数值");
                console.debug(`[a2] ${game.name} ${date} 云图读取成功，正在写入飞书多维表`);
                failure = "飞书多维表写入失败";
                await sink.upsert(game.name, date!, values);
                if (state.day !== day) { state.day = day; state.done = []; }
                state.done ??= []; state.done.push(key);
                failure = "保存采集进度失败";
                await atomicJson(path, state);
                written++;
                console.info(`[a2] ${game.name} ${date} 飞书多维表写入成功`);
              }
            } finally { await page.close(); }
          } catch (error) {
            const reason = collectionError(error, failure);
            errors.push(`${game.name}：${reason}`);
            console.error(`[a2] ${game.name}${activeDate ? ` ${activeDate}` : ""}：${reason}`);
          }
        }
        browserFailure = "关闭采集浏览器失败";
      } finally { await browser.close(); }
    } catch {
      errors.push(browserFailure);
      console.error(`[a2] ${browserFailure}`);
    }
    state.lastRunAt = now.toISOString(); state.errors = errors;
    if (!errors.length) state.completedDay = day;
    await atomicJson(path, state);
    console.info(`[a2] ${day} 采集${errors.length ? "失败" : "完成"}，本次写入 ${written} 条，跳过 ${skipped} 条，失败 ${errors.length} 项，耗时 ${Math.round(performance.now() - started)}ms`);
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
    const result = await response.json() as any;
    if (!response.ok || result.code !== 0) throw new Error(`飞书 A2 操作失败 (${result.code ?? response.status})`);
    return result.data;
  }
  private async items(path: string, key: string): Promise<any[]> {
    const items: any[] = []; let cursor = "";
    do {
      const result = await this.api(`${path}${path.includes("?") ? "&" : "?"}page_size=100${cursor ? `&page_token=${encodeURIComponent(cursor)}` : ""}`);
      items.push(...result[key] ?? []);
      cursor = result.has_more ? result.page_token : "";
      if (result.has_more && !cursor) throw new Error("飞书分页缺少游标");
    } while (cursor);
    return items;
  }
  private async baseRoot(): Promise<string> {
    if (!this.token || Date.now() >= this.tokenExpiresAt) {
      const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.secret }), signal: AbortSignal.timeout(30000),
      });
      const result = await response.json() as any;
      if (result.code !== 0 || !result.tenant_access_token) throw new Error("飞书应用认证失败");
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
  async readDaily(name: string): Promise<Array<{ date: string; A2: number; other_A2: number }>> {
    const root = await this.baseRoot();
    const table = (await this.items(root, "items")).find(table => table.name === name);
    if (!table) throw new Error(`${name}暂无 A2 数据表`);
    const index = new Map<string, { date: string; A2: number; other_A2: number }>();
    for (const row of await this.items(`${root}/${table.table_id}/records`, "items")) {
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
  async upsert(name: string, date: string, a2: { A2: number; other_A2: number }) {
    const tableRoot = await this.tableRoot(name);
    const timestamp = Date.parse(`${date}T00:00:00+08:00`);
    const rows = await this.items(`${tableRoot}/records`, "items");
    const matches = rows.filter(r => {
      const value = r.fields?.["日期"];
      return typeof value === "number" && a2Dates(new Date(value)).day === date;
    });
    if (matches.length > 1) throw new Error("日期存在重复记录，请先合并");
    const fieldsValue = { 日期: timestamp, ...a2, 游戏: name };
    if (matches[0]) await this.api(`${tableRoot}/records/${matches[0].record_id}`, "PUT", { fields: fieldsValue });
    else await this.api(`${tableRoot}/records`, "POST", { fields: fieldsValue });
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
