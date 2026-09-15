const state = { periods: [], chats: [], defaultChatId: "", larkConfigured: false };

const form = document.querySelector("#reportForm");
const chatList = document.querySelector("#chatList");
const projectList = document.querySelector("#projectList");
const chatHint = document.querySelector("#chatHint");
const manualChatId = document.querySelector("#manualChatId");
const preview = document.querySelector("#preview");
const previewButton = document.querySelector("#previewButton");
const sendButton = document.querySelector("#sendButton");
const connectionState = document.querySelector("#connectionState");
const toast = document.querySelector("#toast");
const enableForwardInput = form.elements.enableForward;
const enableForwardInteractionInput = form.elements.enableForwardInteraction;

await loadBootstrap();

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
manualChatId.addEventListener("input", updateSummary);
previewButton.addEventListener("click", () => runAction("preview"));
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void runAction("send");
});

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

function renderChats(chats, defaultChatId, error) {
  chatList.replaceChildren();
  chatList.classList.remove("skeleton-list");
  if (!chats.length) {
    const empty = document.createElement("p");
    empty.textContent = "暂未读取到群聊，可在下方直接输入 chat_id。";
    empty.className = "field-hint";
    chatList.append(empty);
  }

  for (const chat of chats) {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "chatId";
    input.value = chat.chatId;
    input.checked = chat.chatId === defaultChatId;
    const copy = document.createElement("span");
    copy.className = "choice-copy";
    const strong = document.createElement("strong");
    strong.textContent = chat.name;
    const small = document.createElement("small");
    small.textContent = chat.chatId;
    copy.append(strong, small);
    label.append(input, copy);
    chatList.append(label);
  }

  const defaultIsListed = chats.some((chat) => chat.chatId === defaultChatId);
  manualChatId.value = defaultIsListed ? "" : (defaultChatId || "");
  chatHint.textContent = error || (chats.length ? `已读取 ${chats.length} 个机器人所在群聊` : "");
}

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
  const names = [];
  let projectCount = 0;
  for (const checkbox of projectList.querySelectorAll(".project-check")) {
    if (!checkbox.checked) continue;
    const row = checkbox.closest(".project-item");
    const selected = [...row.querySelectorAll(".period-check:checked")];
    if (selected.length === 0) continue;
    projectCount += 1;
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
  return { periodIds, projectCount, mode, rankingMode, enableForward, enableForwardInteraction, showTrend, names };
}

function syncForwardPermissions() {
  enableForwardInteractionInput.disabled = !enableForwardInput.checked;
  if (!enableForwardInput.checked) enableForwardInteractionInput.checked = false;
}

function collectChatIds() {
  const ids = [...form.querySelectorAll('input[name="chatId"]:checked')].map((input) => input.value);
  if (manualChatId.value.trim()) ids.push(manualChatId.value.trim());
  return [...new Set(ids)];
}

function updateSummary() {
  const request = collectRequest();
  const chatIds = collectChatIds();
  document.querySelector("#projectCount").textContent = String(request.projectCount);
  document.querySelector("#cardCount").textContent = String(request.mode === "combined" && request.periodIds.length ? 1 : request.periodIds.length);
  document.querySelector("#chatCount").textContent = String(chatIds.length);
  document.querySelector("#selectedSummary").textContent = request.names.length
    ? request.names.join(" · ")
    : "尚未选择项目";
}

async function runAction(kind) {
  const request = collectRequest();
  const chatIds = collectChatIds();
  if (!request.periodIds.length) return showToast("请至少选择一个项目", true);
  if (kind === "send" && !chatIds.length) return showToast("请至少选择或输入一个群聊", true);

  setBusy(true);
  try {
    const response = await fetch(kind === "send" ? "/api/reports/send" : "/api/reports/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, chatIds, names: undefined, projectCount: undefined }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败");
    if (kind === "preview") {
      renderPreview(data.cards);
      showToast(`已生成 ${data.cards.length} 张卡片预览`);
    } else {
      showToast(`发送完成：${data.messageCount} 条消息`);
      preview.innerHTML = `<p>发送成功。共生成 ${data.cardCount} 张卡片，投递 ${data.messageCount} 条消息。</p>`;
    }
  } catch (error) {
    showToast(error.message || "操作失败", true);
  } finally {
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
  sendButton.disabled = busy;
  document.querySelector("#refreshButton").disabled = busy;
  sendButton.querySelector("span").textContent = busy ? "正在处理…" : "立即发送日报";
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast visible${isError ? " error" : ""}`;
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 3800);
}
