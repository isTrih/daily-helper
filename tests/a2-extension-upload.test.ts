import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { z } from "zod";
import { authSchema } from "../src/a2-service.ts";

const background = await Bun.file(new URL("../extension/a2/background.js", import.meta.url)).text();
const url = "https://yuntu.oceanengine.com/yuntu_ng/api/v1/get_audience_asset_profile?aadvid=1793391127052291&brand_id=123&industry_id=22";
const cookie = {
  name: "sessionid", value: "test-cookie", domain: ".oceanengine.com", path: "/",
  secure: true, httpOnly: true, session: true, sameSite: "lax",
};

function extension(initialRequests: unknown[] = [], cookies: unknown[] = [cookie]) {
  let requests = initialRequests;
  let capture!: (details: { url: string; requestHeaders?: { name: string; value: string }[] }) => void;
  let upload!: (message: unknown, sender: unknown, reply: (result: { ok?: boolean; error?: string }) => void) => void;
  const bodies: unknown[] = [];
  runInNewContext(background, {
    URL, AbortSignal,
    chrome: {
      webRequest: { onBeforeSendHeaders: { addListener: (listener: typeof capture) => { capture = listener; } } },
      runtime: { onMessage: { addListener: (listener: typeof upload) => { upload = listener; } } },
      storage: { local: {
        get: async () => ({ requests }),
        set: async (data: { requests: unknown[] }) => { requests = data.requests; },
      } },
      cookies: { getAll: async () => cookies },
    },
    fetch: async (_url: URL, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      bodies.push(body);
      const parsed = authSchema.safeParse(body);
      return parsed.success
        ? Response.json({ games: [new URL(parsed.data.requests[0]!.url).searchParams.get("aadvid")] })
        : Response.json({ error: "请求参数无效", details: z.flattenError(parsed.error) }, { status: 400 });
    },
  });
  return {
    capture, bodies,
    upload: () => new Promise<{ ok?: boolean; error?: string }>(resolve => upload({ type: "upload", origin: "http://localhost:3000" }, {}, resolve)),
  };
}

test("后续不符合上传协议的请求不会覆盖同游戏的有效模板", async () => {
  const browser = extension();
  browser.capture({ url: url + "&signature=ephemeral" });
  for (const invalid of [
    { url: url.replace("industry_id=22", "industry_id=99") },
    { url: url + "&brand_id=456" },
    { url, requestHeaders: [{ name: "x-path-id", value: "a\r\nb" }] },
  ]) {
    browser.capture(invalid);
    expect(await browser.upload()).toMatchObject({ ok: true });
    expect(browser.bodies.at(-1)).toMatchObject({ requests: [{ url, headers: {} }] });
  }
});

test("历史无效模板提示重新访问云图页面，不发送必然失败的请求", async () => {
  const browser = extension([{url: url.replace("brand_id=123", "brand_id=invalid")}]);
  expect((await browser.upload()).error).toContain("重新访问");
  expect(browser.bodies).toHaveLength(0);
  browser.capture({ url });
  expect(await browser.upload()).toMatchObject({ ok: true });
});

test("缺少云图 Cookie 时提示重新登录，不向服务端发送空 Cookie 数组", async () => {
  const browser = extension([{url}], []);
  expect((await browser.upload()).error).toContain("重新登录云图");
  expect(browser.bodies).toHaveLength(0);
});

test("服务端 Cookie 校验失败时只展示固定提示，不回显 Cookie", async () => {
  const browser = extension([{url}], [{ ...cookie, session: false }]);
  const { error } = await browser.upload();
  expect(error).toBe("上传失败 HTTP 400：Cookie 校验失败，请在当前浏览器重新登录云图");
  expect(error).not.toContain(cookie.value);
});
