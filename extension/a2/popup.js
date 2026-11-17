const el = id => document.getElementById(id);
chrome.storage.local.get('origin').then(v => { if(v.origin) el('origin').value=v.origin; });
async function config() {
  const u = new URL(el('origin').value);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname))) throw Error('仅支持 HTTPS 或本地测试地址');
  if (u.username || u.password) throw Error('域名不能包含账号密码');
  if (!await chrome.permissions.request({origins:[u.origin+'/*']})) throw Error('需要目标域名访问权限');
  await chrome.storage.local.set({origin:u.origin});
  return {origin:u.origin};
}
el('upload').onclick = async () => { try {
  const c = await config();
  el('result').textContent='正在上传…';
  const r = await chrome.runtime.sendMessage({type:'upload',...c});
  el('result').textContent = r.error || `已上传 ${r.games.length} 款游戏；可在 A2 日报页面预览和发送。`;
} catch(e) {el('result').textContent=e.message;} };
