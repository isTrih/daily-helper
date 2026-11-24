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

el('collect').onclick = async () => {
  const tokenInput = el('collectToken');
  const token = tokenInput.value.trim();
  const result = el('result');
  if (!token) {
    result.textContent = '请输入服务器的采集令牌。';
    tokenInput.focus();
    return;
  }
  el('collect').disabled = true;
  el('upload').disabled = true;
  try {
    const target = await config();
    tokenInput.value = '';
    result.textContent = '正在从云图采集并写入飞书。关闭插件后，服务器会继续处理。';
    const request = async (type, job) => {
      const response = await chrome.runtime.sendMessage({ ...target, type, token, job });
      if (!response?.ok) throw Error(response?.error || '无法获取云图采集状态，请重试。');
      return response.job;
    };
    let job = await request('collect-start');
    while (job.status === 'running') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      job = await request('collect-status', job.id);
    }
    if (job.status !== 'success') throw Error(`${job.error || '云图采集未完成。'}（运行编号 ${job.id}）`);
    result.textContent = '已从云图重新采集并写入飞书。';
  } catch (error) {
    result.textContent = error.message;
  } finally {
    el('collect').disabled = false;
    el('upload').disabled = false;
  }
};
