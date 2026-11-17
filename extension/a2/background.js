const ALLOWED = new Set(['1753459094831118','1775180790896781','1715399349333006','1793391127052291','1870863252827667']);
let chain = Promise.resolve();
chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  const u = new URL(details.url);
  if (!ALLOWED.has(u.searchParams.get('aadvid')) || !u.searchParams.get('brand_id')) return;
  // Persist only the read-only API template. Never retain dynamic signatures.
  for (const key of [...u.searchParams.keys()]) if (!['aadvid','industry_id','brand_id'].includes(key)) u.searchParams.delete(key);
  chain = chain.then(async () => {
    const {requests = []} = await chrome.storage.local.get('requests');
    const next = requests.filter(r => new URL(r.url).searchParams.get('aadvid') !== u.searchParams.get('aadvid'));
    const headers = Object.fromEntries((details.requestHeaders || []).filter(h => ["x-industry-version","x-path-id"].includes(h.name.toLowerCase())).map(h => [h.name.toLowerCase(),h.value || ""]));
    next.push({url:u.href,headers}); await chrome.storage.local.set({requests:next});
  }).catch(() => {});
}, {urls:['https://yuntu.oceanengine.com/yuntu_ng/api/v1/get_audience_asset_profile*','https://yuntu.oceanengine.com/yuntu_ng/api/v1/get_audience_asset_trend*']}, ['requestHeaders']);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type !== 'upload') return;
  (async () => {
    await chain;
    const {requests = []} = await chrome.storage.local.get('requests');
    if (!requests.length) throw Error('请先访问各游戏云图人群资产页面');
    const raw = await chrome.cookies.getAll({domain:'oceanengine.com'});
    const cookies = raw.map(c => ({name:c.name,value:c.value,domain:c.domain,path:c.path,secure:c.secure,httpOnly:c.httpOnly,expires:c.session ? -1 : c.expirationDate,sameSite:({strict:'Strict',lax:'Lax',no_restriction:'None'})[c.sameSite] || 'Lax'}));
    const response = await fetch(new URL('/api/a2/auth',message.origin),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-A2-Upload':'yuntu-session-v1'},body:JSON.stringify({requests,cookies}),signal:AbortSignal.timeout(30000)});
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      const detail = typeof failure?.error === 'string' ? failure.error.slice(0, 160) : '请检查服务器地址并重新加载插件';
      throw Error(`上传失败 HTTP ${response.status}：${detail}`);
    }
    reply({ok:true, games:(await response.json()).games});
  })().catch(e => reply({error:e.message}));
  return true;
});
