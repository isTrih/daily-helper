const ALLOWED = new Set(['1753459094831118','1775180790896781','1715399349333006','1793391127052291','1870863252827667']);
const QUERY_KEYS = new Set(['aadvid', 'industry_id', 'brand_id']);
const HEADER_NAMES = new Set(['x-industry-version', 'x-path-id']);
let chain = Promise.resolve();

function readUrl(value) {
  return typeof value === 'string' && URL.canParse(value) ? new URL(value) : null;
}

function template(url, headers = {}) {
  const u = readUrl(url);
  if (!u || u.origin !== 'https://yuntu.oceanengine.com' || u.username || u.password || u.hash ||
      !/^\/yuntu_ng\/api\/v1\/get_audience_asset_(profile|trend)$/.test(u.pathname) ||
      !ALLOWED.has(u.searchParams.get('aadvid')) || !/^\d+$/.test(u.searchParams.get('brand_id') ?? '') ||
      (u.searchParams.has('industry_id') && u.searchParams.get('industry_id') !== '22')) return null;

  for (const key of new Set(u.searchParams.keys())) {
    if (!QUERY_KEYS.has(key)) u.searchParams.delete(key);
    else if (u.searchParams.getAll(key).length !== 1) return null;
  }
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null;
  const allowedHeaders = Object.entries(headers).filter(([name]) => HEADER_NAMES.has(name));
  if (allowedHeaders.some(([, value]) => typeof value !== 'string' || value.length > 512 || /[\r\n]/.test(value))) return null;
  return { aid: u.searchParams.get('aadvid'), request: { url: u.href, headers: Object.fromEntries(allowedHeaders) } };
}

chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  // Persist only the read-only API template. Never retain dynamic signatures.
  const headers = Object.fromEntries((details.requestHeaders || [])
    .map(h => [h.name.toLowerCase(), h.value ?? '']).filter(([name]) => HEADER_NAMES.has(name)));
  const captured = template(details.url, headers);
  if (!captured) return;
  chain = chain.then(async () => {
    const {requests = []} = await chrome.storage.local.get('requests');
    const next = (Array.isArray(requests) ? requests : []).filter(entry => {
      const saved = readUrl(entry?.url);
      return saved && saved.searchParams.get('aadvid') !== captured.aid;
    });
    next.push(captured.request);
    await chrome.storage.local.set({requests:next});
  }).catch(() => {});
}, {urls:['https://yuntu.oceanengine.com/yuntu_ng/api/v1/get_audience_asset_profile*','https://yuntu.oceanengine.com/yuntu_ng/api/v1/get_audience_asset_trend*']}, ['requestHeaders']);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type !== 'upload') return;
  (async () => {
    await chain;
    const {requests: stored = []} = await chrome.storage.local.get('requests');
    if (!Array.isArray(stored) || !stored.length) throw Error('请先访问各游戏云图人群资产页面');
    const requests = new Map();
    for (const entry of stored) {
      const saved = template(entry?.url, entry?.headers);
      if (!saved || requests.has(saved.aid)) throw Error('已保存的游戏请求模板无效，请重新访问五款游戏的云图人群资产页面后再上传');
      requests.set(saved.aid, saved.request);
    }
    const raw = await chrome.cookies.getAll({domain:'oceanengine.com'});
    if (!raw.length) throw Error('没有读取到云图 Cookie，请在当前浏览器重新登录云图后再上传');
    const cookies = raw.map(c => ({name:c.name,value:c.value,domain:c.domain,path:c.path,secure:c.secure,httpOnly:c.httpOnly,expires:c.session ? -1 : c.expirationDate,sameSite:({strict:'Strict',lax:'Lax',no_restriction:'None'})[c.sameSite] || 'Lax'}));
    const response = await fetch(new URL('/api/a2/auth',message.origin),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-A2-Upload':'yuntu-session-v1'},body:JSON.stringify({requests:[...requests.values()],cookies}),signal:AbortSignal.timeout(30000)});
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      let detail = typeof failure?.error === 'string' ? failure.error.slice(0, 160) : '请检查服务器地址并重新加载插件';
      if (response.status === 400 && failure?.error === '请求参数无效') {
        const fields = failure.details?.fieldErrors;
        const tips = [];
        if (fields?.cookies?.length) tips.push('Cookie 校验失败，请在当前浏览器重新登录云图');
        if (fields?.requests?.length) tips.push('游戏请求模板校验失败，请重新访问五款游戏的云图人群资产页面');
        if (tips.length) detail = tips.join('；');
      }
      throw Error(`上传失败 HTTP ${response.status}：${detail}`);
    }
    reply({ok:true, games:(await response.json()).games});
  })().catch(e => reply({error:e.message}));
  return true;
});
