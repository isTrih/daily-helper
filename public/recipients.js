export class RecipientPicker {
  constructor(host, onChange = () => {}) {
    this.host = host; this.onChange = onChange; this.selected = new Map(); this.chats = []; this.users = []; this.initialized = false;
    host.classList.remove('skeleton-list'); host.classList.add('recipient-picker');
    const el = (tag, content, cls) => { const node = document.createElement(tag); if (content) node.textContent = content; if (cls) node.className = cls; return node; };
    this.el = el;
    const tools = el('div', '', 'recipient-tools');
    const typeLabel = el('label', '收件人类型'); this.type = el('select');
    for (const [value, name] of [['chat', '群聊'], ['user', '用户私聊']]) { const option = el('option', name); option.value = value; this.type.append(option); }
    typeLabel.append(this.type);
    const searchLabel = el('label', '搜索'); this.search = el('input'); this.search.type = 'search'; this.search.placeholder = '按名称或 ID 搜索'; searchLabel.append(this.search);
    tools.append(typeLabel, searchLabel);
    this.hint = el('p', '', 'field-hint'); this.hint.setAttribute('role', 'status');
    const actions = el('div', '', 'recipient-actions');
    const button = (label, action) => { const b = el('button', label, 'text-button'); b.type = 'button'; b.onclick = action; return b; };
    this.reload = button('读取用户列表', () => this.loadUsers());
    actions.append(button('全选搜索结果', () => { const items = this.filtered(); if (new Set([...this.selected.keys(), ...items.map(i => this.key(i))]).size > 500) { this.hint.textContent = '每个计划最多选择 500 个收件人，请分批设置。'; return; } items.forEach(i => this.selected.set(this.key(i), i)); this.render(); this.changed(); }), button('清空所选', () => { this.selected.clear(); this.manual.value = ''; this.render(); this.changed(); }), this.reload);
    this.list = el('div', '', 'recipient-options');
    const manualLabel = el('label', '手动添加 ID（支持多个，用换行、空格或逗号分隔）', 'manual-chat');
    this.manual = el('textarea'); this.manual.rows = 2; this.manual.placeholder = '群聊 oc_… / 当前应用用户 ou_…'; manualLabel.append(this.manual);
    this.summary = el('div', '', 'recipient-selected'); this.summary.setAttribute('aria-live', 'polite');
    host.replaceChildren(tools, this.hint, actions, this.list, manualLabel, this.summary);
    this.type.onchange = () => { this.search.value = ''; this.render(); if (this.type.value === 'user' && !this.usersLoaded) void this.loadUsers(); };
    this.search.oninput = () => this.render(); this.manual.oninput = () => this.changed();
    this.render(); this.changed();
  }
  key(item) { return item.type + ':' + item.id; }
  setChats(chats, defaultChatId, error) {
    this.chats = chats.map(c => ({ type: 'chat', id: c.chatId, name: c.name })); this.chatsError = error;
    if (!this.initialized && defaultChatId) this.selected.set('chat:' + defaultChatId, this.chats.find(c => c.id === defaultChatId) || { type: 'chat', id: defaultChatId });
    this.initialized = true; this.render(); this.changed();
  }
  async loadUsers() {
    if (this.loading) return;
    this.loading = true; this.render();
    try { const response = await fetch('/api/recipients/users' + (this.usersLoaded ? '?refresh=1' : ''), { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw Error(data.error || '用户读取失败'); this.users = data.users.map(u => ({ type: 'user', ...u })); this.usersLoaded = true; this.usersError = data.warning || ''; }
    catch (error) { this.usersError = error.message; }
    finally { this.loading = false; this.render(); this.changed(); }
  }
  filtered() { const query = this.search.value.trim().toLocaleLowerCase(); return (this.type.value === 'user' ? this.users : this.chats).filter(i => (i.name + ' ' + i.id).toLocaleLowerCase().includes(query)); }
  name(target) { return [...this.chats, ...this.users].find(i => this.key(i) === this.key(target))?.name || target.id; }
  describe(targets) { return targets.slice(0, 3).map(t => `${t.type === 'user' ? '私聊' : '群聊'} · ${this.name(t)}`).join('、') + (targets.length > 3 ? ` 等 ${targets.length} 个收件人` : ''); }
  setSelection(targets) { this.selected = new Map(targets.map(t => [this.key(t), t])); this.manual.value = ''; if (targets.length && targets.every(t => t.type === 'user')) this.type.value = 'user'; else this.type.value = 'chat'; this.render(); this.changed(); }
  getSelection() {
    const result = new Map(this.selected);
    for (const id of this.manual.value.trim().split(/[\s,，;；]+/).filter(Boolean)) {
      if (!/^(oc|ou)_[\w-]+$/.test(id)) throw Error('ID 格式无效：群聊用 oc_ 开头，用户用当前应用的 ou_ 开头 open_id');
      const item = { type: id.startsWith('ou_') ? 'user' : 'chat', id }; result.set(this.key(item), item);
    }
    if (result.size > 500) throw Error('每个计划最多选择 500 个收件人，请分批设置');
    return [...result.values()].map(({ type, id }) => ({ type, id }));
  }
  changed() {
    this.summary.replaceChildren(this.el('strong', `已选择 ${this.selected.size} 个收件人${this.manual.value.trim() ? '，另有手动填写的 ID' : ''}`));
    for (const target of this.selected.values()) { const b = this.el('button', `${target.type === 'user' ? '私聊' : '群聊'} · ${this.name(target)} ×`); b.type = 'button'; b.setAttribute('aria-label', '移除' + this.name(target)); b.onclick = () => { this.selected.delete(this.key(target)); this.render(); this.changed(); }; this.summary.append(b); }
    this.onChange();
  }
  render() {
    const userMode = this.type.value === 'user'; this.reload.hidden = !userMode; this.reload.disabled = this.loading; this.reload.textContent = this.loading ? '正在读取群成员…' : '刷新用户列表';
    this.hint.textContent = userMode ? this.loading ? '正在读取机器人所在群聊的成员，首次加载可能需要一些时间。' : this.usersError || `机器人所在群聊的成员 ${this.users.length} 人，已跨群去重。` : this.chatsError || `机器人所在群聊 ${this.chats.length} 个；其他群请先将机器人加入群聊。`;
    this.list.replaceChildren(); const items = this.filtered();
    if (!items.length) this.list.append(this.el('p', this.loading ? '正在加载…' : '暂无匹配结果，可手动填写 ID。', 'field-hint'));
    for (const item of items) { const label = this.el('label', '', 'choice'); const input = this.el('input'); input.type = 'checkbox'; input.checked = this.selected.has(this.key(item)); input.value = item.id; input.onchange = () => { if (input.checked && this.selected.size >= 500) { input.checked = false; this.hint.textContent = '每个计划最多选择 500 个收件人。'; return; } input.checked ? this.selected.set(this.key(item), item) : this.selected.delete(this.key(item)); this.changed(); }; const copy = this.el('span', '', 'choice-copy'); copy.append(this.el('strong', item.name), this.el('small', item.id)); label.append(input, copy); this.list.append(label); }
  }
}

export const savedRecipients = schedule => schedule.recipients || (schedule.chatId ? [{ type: 'chat', id: schedule.chatId }] : []);
