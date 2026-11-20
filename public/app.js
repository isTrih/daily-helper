import { RecipientPicker, savedRecipients } from "/recipients.js?v=2";
const state = {
  periods: [],
  chats: [],
  schedules: [],
  topicKeywords: [],
  defaultChatId: "",
  larkConfigured: false,
  timezone: "Asia/Shanghai",
  editingScheduleId: null,
};
const MAX_TOPIC_KEYWORDS = 6;

const form = document.querySelector("#reportForm");
const chatList = document.querySelector("#chatList");
const projectList = document.querySelector("#projectList");


const preview = document.querySelector("#preview");
const previewButton = document.querySelector("#previewButton");
const refreshReportButton = document.querySelector("#refreshReportButton");
const sendButton = document.querySelector("#sendButton");
const connectionState = document.querySelector("#connectionState");
const toast = document.querySelector("#toast");
const enableForwardInput = form.elements.enableForward;
const enableForwardInteractionInput = form.elements.enableForwardInteraction;
const topicInput = document.querySelector("#topicInput");
const topicList = document.querySelector("#topicList");
const addTopicButton = document.querySelector("#addTopicButton");
const scheduleList = document.querySelector("#scheduleList");
const scheduleName = document.querySelector("#scheduleName");
const scheduleTime = document.querySelector("#scheduleTime");
const scheduleLatest = document.querySelector("#scheduleLatest");
const scheduleEnabled = document.querySelector("#scheduleEnabled");
const saveScheduleButton = document.querySelector("#saveScheduleButton");
const cancelScheduleButton = document.querySelector("#cancelScheduleButton");

document.querySelector("#refreshButton").addEventListener("click", loadBootstrap);
document.querySelector("#selectLatestButton").addEventListener("click", () => {
  for (const row of projectList.querySelectorAll(".project-item")) {
    row.querySelector(".project-check").checked = true;
    for (const period of row.querySelectorAll(".period-check")) {
      period.checked = period.dataset.latest === "true";
    }
    updatePeriodPicker(row);
  }
  updateSummary();
});
form.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches(".period-check")) {
    const row = target.closest(".project-item");
    const selected = [...row.querySelectorAll(".period-check:checked")];
    if (selected.length > 2) {
      target.checked = false;
      showToast("同一个项目最多选择两个期次", true);
    } else if (selected.length > 0) {
      row.querySelector(".project-check").checked = true;
    }
    updatePeriodPicker(row);
  }
  if (target.matches(".project-check") && target.checked) {
    const row = target.closest(".project-item");
    if (!row.querySelector(".period-check:checked")) {
      const latest = row.querySelector('.period-check[data-latest="true"]') || row.querySelector(".period-check");
      if (latest) latest.checked = true;
    }
    updatePeriodPicker(row);
  }
  syncForwardPermissions();
  updateSummary();
});
const recipientPicker = new RecipientPicker(chatList, () => queueMicrotask(updateSummary));
addTopicButton.addEventListener("click", addTopicsFromInput);
topicInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== "," && event.key !== "，") return;
  event.preventDefault();
  addTopicsFromInput();
});
topicList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-topic]");
  if (!button) return;
  state.topicKeywords = state.topicKeywords.filter((topic) => topic !== button.dataset.topic);
  renderTopics();
  updateSummary();
});
previewButton.addEventListener("click", () => runAction("preview"));
refreshReportButton.addEventListener("click", () => runAction("refresh"));
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void runAction("send");
});
saveScheduleButton.addEventListener("click", saveSchedule);
cancelScheduleButton.addEventListener("click", resetScheduleEditor);
scheduleList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-schedule-action]");
  if (!button) return;
  void handleScheduleAction(button.dataset.scheduleAction, button.dataset.scheduleId);
});

void loadBootstrap();

async function loadBootstrap() {
  setBusy(true);
  connectionState.className = "connection";
  connectionState.innerHTML = "<span></span>正在连接数据源";
  try {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取配置失败");
    Object.assign(state, data);
    renderChats(data.chats, data.defaultChatId, data.chatsError);
    renderProjects(data.periods);
    renderTopics();
    renderSchedules(data.schedules || []);
    document.querySelector("#timezoneLabel").textContent = data.timezone || "Asia/Shanghai";
    document.querySelector("#todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "long", day: "numeric", weekday: "short",
    }).format(new Date());
    connectionState.className = "connection ready";
    connectionState.innerHTML = `<span></span>${data.larkConfigured ? "数据源与飞书已连接" : "数据源已连接 · 飞书待配置"}`;
    updateSummary();
  } catch (error) {
    connectionState.className = "connection error";
    connectionState.innerHTML = "<span></span>连接失败";
    showToast(error.message || "加载失败", true);
  } finally {
    setBusy(false);
  }
}

function renderChats(chats, defaultChatId, error) { recipientPicker.setChats(chats, defaultChatId, error); }

function renderProjects(periods) {
  projectList.replaceChildren();
  projectList.classList.remove("skeleton-list");
  const grouped = new Map();
  for (const period of periods) {
    const items = grouped.get(period.projectId) || [];
    items.push(period);
    grouped.set(period.projectId, items);
  }

  for (const [projectId, items] of grouped) {
    const sorted = [...items].sort((a, b) => b.activityPeriodId - a.activityPeriodId);
    const latest = sorted.find((item) => item.isLatest) || sorted[0];
    const row = document.createElement("div");
    row.className = "project-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "project-check";
    checkbox.checked = true;
    checkbox.dataset.projectId = String(projectId);
    checkbox.setAttribute("aria-label", `选择${latest?.projectDisplayName || `项目 ${projectId}`}`);
    const copy = document.createElement("span");
    copy.className = "project-copy";
    const titleRow = document.createElement("strong");
    const dot = document.createElement("i");
    dot.className = `project-dot project-${projectId}`;
    dot.style.display = "inline-block";
    dot.style.marginRight = "8px";
    const titleText = document.createTextNode(latest?.projectDisplayName || `项目 ${projectId}`);
    titleRow.append(dot, titleText);
    const meta = document.createElement("small");
    meta.textContent = `${sorted.length} 个可选期次 · 默认最新`;
    copy.append(titleRow, meta);
    const picker = document.createElement("details");
    picker.className = "period-select";
    picker.dataset.projectId = String(projectId);
    const summary = document.createElement("summary");
    const summaryLabel = document.createElement("span");
    summaryLabel.className = "period-select-label";
    summary.append(summaryLabel);
    const options = document.createElement("div");
    options.className = "period-options";
    for (const period of sorted) {
      const option = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "period-check";
      input.value = String(period.activityPeriodId);
      input.dataset.projectId = String(projectId);
      input.dataset.latest = String(period.isLatest);
      input.checked = period.isLatest;
      const text = document.createElement("span");
      text.textContent = period.period;
      option.append(input, text);
      options.append(option);
    }
    picker.append(summary, options);
    row.append(checkbox, copy, picker);
    projectList.append(row);
    updatePeriodPicker(row);
  }
}

function updatePeriodPicker(row) {
  const selected = [...row.querySelectorAll(".period-check:checked")];
  const label = row.querySelector(".period-select-label");
  label.textContent = selected.length === 0
    ? "请选择期次"
    : selected.length === 1
      ? selected[0].nextElementSibling.textContent
      : `已选 ${selected.length} 个期次`;
}

function collectRequest() {
  const periodIds = [];
  const projectIds = [];
  const names = [];
  let projectCount = 0;
  for (const checkbox of projectList.querySelectorAll(".project-check")) {
    if (!checkbox.checked) continue;
    const row = checkbox.closest(".project-item");
    const selected = [...row.querySelectorAll(".period-check:checked")];
    if (selected.length === 0) continue;
    projectCount += 1;
    projectIds.push(Number(checkbox.dataset.projectId));
    for (const period of selected) {
      periodIds.push(Number(period.value));
      names.push(period.nextElementSibling.textContent || period.value);
    }
  }
  const mode = form.elements.mode.value;
  const rankingMode = form.elements.rankingMode.value;
  const enableForward = enableForwardInput.checked;
  const enableForwardInteraction = enableForward && enableForwardInteractionInput.checked;
  const showTrend = form.elements.showTrend.checked;
  return {
    periodIds,
    projectIds,
    projectCount,
    mode,
    rankingMode,
    enableForward,
    enableForwardInteraction,
    showTrend,
    topicKeywords: [...state.topicKeywords],
    names,
  };
}

function syncForwardPermissions() {
  enableForwardInteractionInput.disabled = !enableForwardInput.checked;
  if (!enableForwardInput.checked) enableForwardInteractionInput.checked = false;
}

function collectRecipients() { return recipientPicker.getSelection(); }
function validateRecipients() { try { return collectRecipients(); } catch (error) { showToast(error.message, true); return null; } }

function updateSummary() {
  const request = collectRequest();
  let recipients; try { recipients = collectRecipients(); } catch { recipients = []; }
  document.querySelector("#projectCount").textContent = String(request.projectCount);
  const baseCardCount = request.mode === "combined" && request.periodIds.length ? 1 : request.periodIds.length;
  document.querySelector("#cardCount").textContent = String(baseCardCount * Math.max(1, request.topicKeywords.length));
  document.querySelector("#chatCount").textContent = String(recipients.length);
  document.querySelector("#topicCount").textContent = request.topicKeywords.length ? String(request.topicKeywords.length) : "全部";
  document.querySelector("#selectedSummary").textContent = request.names.length
    ? `${request.names.join(" · ")}${request.topicKeywords.length ? `｜${request.topicKeywords.map((topic) => `#${topic}`).join(" · ")}` : ""}`
    : "尚未选择项目";
}

async function runAction(kind) {
  if (sendButton.disabled) return;
  addTopicsFromInput();
  const request = collectRequest();
  const refresh = kind === "refresh";
  const recipients = refresh ? [] : validateRecipients();
  if (!recipients) return;
  if (!request.periodIds.length) return showToast("请至少选择一个项目", true);
  if (kind === "send" && !recipients.length) return showToast("请至少选择或输入一个群聊或用户", true);

  setBusy(true);
  if (refresh) refreshReportButton.textContent = "正在重新拉取…";
  try {
    const response = await fetch(kind === "send" ? "/api/reports/send" : "/api/reports/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, recipients, ...(refresh ? { refresh } : {}), names: undefined, projectCount: undefined }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败");
    if (kind !== "send") {
      renderPreview(data.cards);
      showToast(refresh ? "已重新拉取数据，预览已更新" : `已生成 ${data.cards.length} 张卡片预览`);
    } else {
      showToast(`发送完成：${data.messageCount} 条消息`);
      preview.innerHTML = `<p>发送成功。共生成 ${data.cardCount} 张卡片，投递 ${data.messageCount} 条消息。</p>`;
    }
  } catch (error) {
    showToast(error.message || "操作失败", true);
  } finally {
    refreshReportButton.textContent = "重新拉取数据";
    setBusy(false);
  }
}

function renderPreview(cards) {
  preview.replaceChildren();
  for (const card of cards) {
    const item = document.createElement("div");
    item.className = "preview-card";
    const title = document.createElement("strong");
    title.textContent = card.header?.title?.content || "未命名卡片";
    const detail = document.createElement("span");
    const tags = (card.header?.text_tag_list || []).map((tag) => tag.text?.content).filter(Boolean);
    detail.textContent = `${card.header?.subtitle?.content || ""}${tags.length ? ` · ${tags.join(" / ")}` : ""}`;
    item.append(title, detail);
    preview.append(item);
  }
}

function setBusy(busy) {
  previewButton.disabled = busy;
  refreshReportButton.disabled = busy;
  sendButton.disabled = busy;
  document.querySelector("#refreshButton").disabled = busy;
  saveScheduleButton.disabled = busy;
  sendButton.querySelector("span").textContent = busy ? "正在处理…" : "立即发送日报";
}

function addTopicsFromInput() {
  const candidates = topicInput.value.split(/[\n,，]+/).map(normalizeTopic).filter(Boolean);
  if (!candidates.length) return;
  const topics = [...state.topicKeywords];
  for (const candidate of candidates) {
    if (topics.some((topic) => topic.toLocaleLowerCase("zh-CN") === candidate.toLocaleLowerCase("zh-CN"))) continue;
    if (topics.length >= MAX_TOPIC_KEYWORDS) {
      showToast(`最多设置 ${MAX_TOPIC_KEYWORDS} 个话题关键词`, true);
      break;
    }
    topics.push(candidate);
  }
  state.topicKeywords = topics;
  topicInput.value = "";
  renderTopics();
  updateSummary();
}

function normalizeTopic(value) {
  return value.trim().replace(/^[#＃]+\s*/, "").trim();
}

function renderTopics() {
  topicList.replaceChildren();
  if (!state.topicKeywords.length) {
    const empty = document.createElement("span");
    empty.className = "topic-empty";
    empty.textContent = "未设置时展示全部内容";
    topicList.append(empty);
    return;
  }
  for (const topic of state.topicKeywords) {
    const chip = document.createElement("span");
    chip.className = "topic-chip";
    const text = document.createElement("span");
    text.textContent = `#${topic}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.topic = topic;
    remove.setAttribute("aria-label", `移除话题 ${topic}`);
    remove.textContent = "移除";
    chip.append(text, remove);
    topicList.append(chip);
  }
}

async function saveSchedule() {
  addTopicsFromInput();
  const request = collectRequest();
  const recipients = validateRecipients();
  if (!recipients) return;
  if (!recipients.length) return showToast("请选择至少一个群聊或用户", true);
  if (!request.periodIds.length) return showToast("请至少选择一个项目", true);
  const name = scheduleName.value.trim() || `${recipients.length === 1 ? recipientPicker.name(recipients[0]) : "多收件人"}日报`;
  const payload = {
    name,
    recipients,
    time: scheduleTime.value,
    enabled: scheduleEnabled.checked,
    request: {
      periodIds: scheduleLatest.checked ? [] : request.periodIds,
      projectIds: request.projectIds,
      mode: request.mode,
      rankingMode: request.rankingMode,
      enableForward: request.enableForward,
      enableForwardInteraction: request.enableForwardInteraction,
      showTrend: request.showTrend,
      topicKeywords: request.topicKeywords,
    },
  };
  setBusy(true);
  try {
    const editingId = state.editingScheduleId;
    const response = await fetch(editingId ? `/api/schedules/${editingId}` : "/api/schedules", {
      method: editingId ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "保存每日计划失败");
    await reloadSchedules();
    resetScheduleEditor();
    showToast(editingId ? "每日计划已更新" : "每日计划已保存");
  } catch (error) {
    showToast(error.message || "保存每日计划失败", true);
  } finally {
    setBusy(false);
  }
}

async function reloadSchedules() {
  const response = await fetch("/api/schedules", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "读取每日计划失败");
  renderSchedules(data.schedules || []);
}

function renderSchedules(schedules) {
  state.schedules = schedules;
  scheduleList.replaceChildren();
  if (!schedules.length) {
    const empty = document.createElement("div");
    empty.className = "schedule-empty";
    empty.textContent = "还没有每日推送计划。完成上方选择后，保存第一条计划。";
    scheduleList.append(empty);
    return;
  }
  for (const schedule of schedules) scheduleList.append(scheduleItem(schedule));
}

function scheduleItem(schedule) {
  const item = document.createElement("article");
  item.className = `schedule-item${schedule.enabled ? "" : " is-paused"}`;

  const primary = document.createElement("div");
  primary.className = "schedule-primary";
  const title = document.createElement("div");
  title.className = "schedule-title";
  const dot = document.createElement("span");
  dot.className = "status-dot";
  const strong = document.createElement("strong");
  strong.textContent = schedule.name;
  title.append(dot, strong);
  const target = document.createElement("small");
  target.textContent = `${recipientPicker.describe(savedRecipients(schedule))} · 每日 ${schedule.time}`;
  primary.append(title, target);

  const detail = document.createElement("div");
  detail.className = "schedule-detail";
  const mode = schedule.request.mode === "combined" ? "多合一" : "单独日报";
  const ranking = { today: "今日 TOP", yesterday: "昨日 TOP", period: "本期 TOP" }[schedule.request.rankingMode];
  const source = schedule.request.periodIds.length
    ? `固定 ${schedule.request.periodIds.length} 个期次`
    : `${schedule.request.projectIds.length} 个项目的最新期次`;
  const topics = schedule.request.topicKeywords.length
    ? schedule.request.topicKeywords.map((topic) => `#${topic}`).join(" · ")
    : "全部内容";
  const parameters = [
    topics,
    schedule.request.showTrend ? "显示趋势图" : "不显示趋势图",
    schedule.request.enableForward ? "允许转发" : "禁止转发",
    schedule.request.enableForwardInteraction ? "转发后可交互" : null,
  ].filter(Boolean).join(" · ");
  const summary = document.createElement("strong");
  summary.textContent = `${mode} · ${ranking} · ${source}`;
  const topicLine = document.createElement("span");
  topicLine.textContent = parameters;
  const run = document.createElement("span");
  run.className = `schedule-run${schedule.lastStatus === "error" ? " error" : ""}`;
  run.textContent = scheduleRunText(schedule);
  detail.append(summary, topicLine, run);

  const actions = document.createElement("div");
  actions.className = "schedule-actions";
  actions.append(
    scheduleActionButton("编辑", "edit", schedule.id),
    scheduleActionButton(schedule.enabled ? "停用" : "启用", "toggle", schedule.id),
    scheduleActionButton("删除", "delete", schedule.id, true),
  );
  item.append(primary, detail, actions);
  return item;
}

function scheduleActionButton(label, action, id, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.scheduleAction = action;
  button.dataset.scheduleId = id;
  if (danger) button.className = "danger";
  return button;
}

function scheduleRunText(schedule) {
  if (schedule.lastStatus === "error") return `上次发送失败：${schedule.lastError || "未知错误"}`;
  if (schedule.lastStatus === "running") return "正在发送…";
  if (schedule.lastRunAt) return `上次发送 ${formatDateTime(schedule.lastRunAt)} · 成功`;
  if (schedule.nextRunAt) return `下次发送 ${formatDateTime(schedule.nextRunAt)}`;
  return schedule.enabled ? "等待下一次发送" : "计划已停用";
}

async function handleScheduleAction(action, id) {
  const schedule = state.schedules.find((item) => item.id === id);
  if (!schedule) return;
  if (action === "edit") return editSchedule(schedule);
  if (action === "delete" && !window.confirm(`确认删除“${schedule.name}”？`)) return;
  setBusy(true);
  try {
    const response = await fetch(`/api/schedules/${id}`, action === "delete"
      ? { method: "DELETE" }
      : {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: !schedule.enabled }),
        });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "更新每日计划失败");
    await reloadSchedules();
    if (state.editingScheduleId === id) resetScheduleEditor();
    showToast(action === "delete" ? "每日计划已删除" : `每日计划已${schedule.enabled ? "停用" : "启用"}`);
  } catch (error) {
    showToast(error.message || "更新每日计划失败", true);
  } finally {
    setBusy(false);
  }
}

function editSchedule(schedule) {
  state.editingScheduleId = schedule.id;
  scheduleName.value = schedule.name;
  scheduleTime.value = schedule.time;
  scheduleLatest.checked = schedule.request.periodIds.length === 0;
  scheduleEnabled.checked = schedule.enabled;
  saveScheduleButton.querySelector("span").textContent = "更新每日计划";
  cancelScheduleButton.hidden = false;
  recipientPicker.setSelection(savedRecipients(schedule));
  applyProjectSelection(schedule.request);
  form.elements.mode.value = schedule.request.mode;
  form.elements.rankingMode.value = schedule.request.rankingMode;
  form.elements.showTrend.checked = schedule.request.showTrend;
  enableForwardInput.checked = schedule.request.enableForward;
  enableForwardInteractionInput.checked = schedule.request.enableForwardInteraction;
  state.topicKeywords = [...schedule.request.topicKeywords];
  syncForwardPermissions();
  renderTopics();
  updateSummary();
  document.querySelector("#scheduleTitle").scrollIntoView({ behavior: "smooth", block: "start" });
}


function applyProjectSelection(request) {
  const fixedIds = new Set(request.periodIds.map(Number));
  const projectIds = new Set(request.projectIds.map(Number));
  for (const row of projectList.querySelectorAll(".project-item")) {
    const projectCheck = row.querySelector(".project-check");
    const projectId = Number(projectCheck.dataset.projectId);
    const selectedProject = projectIds.has(projectId) || [...row.querySelectorAll(".period-check")]
      .some((period) => fixedIds.has(Number(period.value)));
    projectCheck.checked = selectedProject;
    for (const period of row.querySelectorAll(".period-check")) {
      period.checked = fixedIds.size > 0
        ? fixedIds.has(Number(period.value))
        : selectedProject && period.dataset.latest === "true";
    }
    updatePeriodPicker(row);
  }
}

function resetScheduleEditor() {
  state.editingScheduleId = null;
  scheduleName.value = "";
  scheduleTime.value = "09:00";
  scheduleLatest.checked = true;
  scheduleEnabled.checked = true;
  saveScheduleButton.querySelector("span").textContent = "保存每日计划";
  cancelScheduleButton.hidden = true;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: state.timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast visible${isError ? " error" : ""}`;
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 3800);
}
