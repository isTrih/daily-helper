# 飞书项目每日快报

基于 Bun、TypeScript 与 [`@larksuiteoapi/node-sdk`](https://github.com/larksuite/node-sdk) 的飞书日报服务。数据来自星图工作流服务的 [OpenAPI 3.1 规范](https://autoxingtu.api.ali.trih.top/api-doc/openapi.json)。

## 已实现

- 每次发送日报卡片前读取会话类型；群聊中按 `user_id` 检查李思远（`db9g11bb`）、徐亚男（`da5da1g1`），仅邀请缺席成员，完成后发送。私聊直接发送；查询或邀请失败、成员无效或入群待审批时停止发送并报错。机器人需要读取群信息、读取群成员和添加群成员的权限，两位用户须在应用可用范围内。
- 默认按 `project_id` 分组，只取数值最大的 `activity_period_id`。多合一日报初始聚焦 `PROJECT_ORDER` 顺位第一个项目，点击“所有项目”后展开全部项目。
- 本期累计展示视频播放、稿件、作者，以及直播 PV、场次、主播；今日与昨日的视频播放使用接口单日增量，新增稿件和新增作者按相邻日期存量差值计算，同时展示直播场次和参与主播，不计算直播 PV 日增。日增指标为零时隐藏对应指标卡；若本期累计没有直播数据，则隐藏全部直播板块。
- 使用 `/api/v1/queries/videos/top-growth` 直接展示每项目 5 条今日、昨日或本期播放增长最快的视频。
- 卡片 JSON 2.0，下拉框及“所有项目”只允许访问发送时选定的项目期次，旧卡片不会自动开放后来新增的期次；“所有项目 / 今日 TOP / 昨日 TOP / 本期 TOP / 折叠按钮组”在宽屏同排展示、窄屏自动换行。“所有项目”使用紧凑视图避免超过飞书组件上限，视频标题可点击打开抖音播放页。卡片交互会立即返回加载卡，再由后台取数并更新原消息，避免查询超时导致回调失败。
- 单期卡片可显示最近最多 31 天的全宽数据趋势：每日视频播放使用左轴面积图，新增稿件和新增作者使用右轴折线图，并使用项目主题的衍生色系。
- 顶部操作区的折叠按钮组可显示或隐藏单期趋势图、将日报收起为精简版本并重新展开；撤回操作会进入确认卡片，确认后调用飞书消息撤回接口，取消则恢复此前视图。
- 互动卡片采用两行页脚，第二行展示“卡片可互动有效期至 YY-MM-DD”；发送时同时锁定日报日期，后续切换、加载、收起和展开不会改变每日、累计、趋势或 TOP 的数据日期，历史日报改用具体月日标注。
- 页脚操作区提供“项目数据看板”飞书 AppLink 按钮，按当前卡片动态填充 `period=<project_id>` 与 `act=<activity_period_id>` 参数；单项目卡片中与原有操作按钮同排展示。
- 网页读取当前机器人所在群聊，可配置多合一或单独日报、勾选项目及期次、排行口径、趋势图及卡片转发权限；同一个项目最多可同时选择两个期次，多合一模式会把同项目两期直接放在一张卡中。
- 网页可配置最多 6 个话题关键词（支持带或不带 `#`）。系统按视频标题分别计算累计、日增、趋势与 Top 5，每个关键词生成独立卡片；卡片页脚看板 AppLink 只追加当前分类对应的 `topics=["关键词"]`，不会携带比较日期等临时页面状态。
- 网页可为群聊和用户私聊保存每日推送计划，支持混合多选收件人，以及独立设置时间、项目、固定/最新期次、话题分类、卡片形式、排行口径、趋势图和转发参数；计划支持编辑、启停和删除，运行结果会持久化到本地 JSON，服务重启后自动恢复，旧群聊计划继续有效。
- 环境变量指定的默认群聊与 Cron 继续作为兼容的全局自动日报；网页计划与其可同时运行。
- 单独日报使用接口返回的 `period` 作为标题，不显示项目、期次和排行切换控件，只在页脚保留收起、趋势图和撤回操作；项目 1/2/3 分别使用金色（飞书 `yellow`）、紫色和绿色主题。
- 群聊中 `@机器人` 后发送“发送数据”或“巴拉拉能量”，以及无需 @ 直接发送“巴拉拉能量”，都会发送所有项目最新一期；`巴拉拉能量 ROK&SAMO` 等指令可按任意符号分隔 `ROK`、`SAMO`、`D1`，并生成所选项目的多合一日报，项目码不区分大小写。
- 私聊中无需 @ 即可使用“发送数据”、“数据发送”或“巴拉拉能量”及其项目定向形式；私聊生成的卡片始终禁止转发及转发后交互。
- 所有星图读取请求都使用 `INTERNAL_API_TOKEN` 作为 JWT Bearer Token。

> 飞书 Card JSON 2.0 的 raw JSON 不支持“循环容器”（该组件只在 CardKit 搭建模板中可用）。项目没有提供 CardKit 模板 ID，因此本项目在服务端用数组循环展开标准 JSON 2.0 组件，实际效果和数据条数一致，也避免部署前还要手工发布模板。

## 启动

需要 Bun 1.4.2 或更高版本。

```bash
bun install
cp .env.example .env
bun run dev
```

Windows PowerShell 可用：

```powershell
Copy-Item .env.example .env
bun run dev
```

管理页默认地址：`http://localhost:3000`。

## 环境变量

复制 `.env.example` 后至少填写：

```dotenv
LARK_APP_ID=cli_xxxxxxxxxxxxxxxx
LARK_APP_SECRET=xxxxxxxxxxxxxxxx
LARK_DEFAULT_CHAT_ID=oc_xxxxxxxxxxxxxxxx
INTERNAL_API_TOKEN=xxxxxxxxxxxxxxxx
PROJECT_ORDER=3,1,2
COLOR=1-yellow,2-purple,3-blue,4-orange
ICON=1-img_v2_xxxxxxxxxxxxxxx,2-img_v2_xxxxxxxxxxxxxxx
```

常用配置：

| 变量                           | 默认值                                | 说明                                                  |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------- |
| `XINGTU_API_BASE`              | `https://autoxingtu.api.ali.trih.top` | 星图 API 根地址                                       |
| `INTERNAL_API_TOKEN`           | 无                                    | 必填；星图 API 的 JWT Bearer Token                    |
| `PROJECT_ORDER`                | 空                                    | project_id 展示顺序，如 `3,1,2`；未列出的项目自动追加 |
| `COLOR`                        | 空                                    | 项目主题色，如 `1-yellow,2-purple,3-blue`；支持 `blue`、`wathet`、`turquoise`、`green`、`yellow`、`orange`、`red`、`carmine`、`violet`、`purple`、`indigo`、`grey` |
| `ICON`                         | 空                                    | 项目标题图标，如 `1-img_v2_xxx,2-img_v2_yyy`；值为飞书图片的 `img_key`，未配置时使用默认图标 |
| `PORT` / `HOST`                | `3000` / `0.0.0.0`                    | 管理页监听地址                                        |
| `LARK_LONG_CONNECTION_ENABLED` | `true`                                | 是否接收卡片长连接回调                                |
| `AUTO_DAILY_REPORT_ENABLED`    | `true`                                | 是否启用自动日报                                      |
| `DAILY_REPORT_CRON`            | `0 9 * * *`                           | 每日发送 Cron（分、时、日、月、周）                   |
| `REPORT_TIMEZONE`              | `Asia/Shanghai`                       | 今日口径和定时任务时区                                |
| `SCHEDULES_FILE`               | `data/schedules.json`                 | 网页每日推送计划的持久化文件                          |

未配置飞书凭证时，服务仍可启动，项目数据、管理页和卡片预览可用；读取群聊、实际发送和长连接会停用。

## 飞书应用配置

1. 在飞书开发者后台启用机器人能力。
2. 为应用开通发送消息和读取会话所需权限（至少包含 `im:message:send_as_bot`；无 @ 群聊指令需要 `im:message.group_msg`，私聊指令需要 `im:message.p2p_msg`），发布应用版本，并把机器人加入目标群聊。
3. 在 **事件与回调 → 回调配置** 中选择 **使用长连接接收回调**。
4. 添加新版 **卡片回传交互** 回调 `card.action.trigger`，以及 **接收消息** 事件 `im.message.receive_v1`。不要同时保留旧版卡片回调，避免一次点击收到两次请求。
5. 配置 `.env` 后重启服务。日志出现“卡片回调长连接已就绪”即接入成功。

发送时先创建 CardKit 卡片实体，再通过 `card_id` 发送，复杂的单期趋势卡不会受直接消息接口的 raw JSON 限制；卡片点击后先在长连接响应中返回加载卡，处理器在后台并发查询所需汇总与 Top 5，再全量更新卡片实体。取数失败时会显示可重新加载的错误卡，不依赖公网 Webhook。

卡片撤回仅适用于机器人自己发送、且仍在企业管理员配置的撤回时限内的消息；飞书拒绝撤回时，确认卡片会保留并显示失败提示。

## 数据口径

- 项目/期次：`GET /api/v1/queries/projects`，并用 `GET /api/v1/queries/periods` 补充追踪日期。
- 内容配置：`GET /api/v1/queries/contents`，按 `activity_period_id + content_type` 找到视频和直播的 `content_config_id`。
- 本期累计：从 `tracking_start_date` 查询至今天或 `tracking_end_date`（取较早者）。
- 今日新增：汇总接口使用 `date=今天`。
- 视频汇总：`GET /api/v1/queries/videos/summary`。
- 直播汇总：`GET /api/v1/queries/lives/summary`。
- 增长排行：`GET /api/v1/queries/videos/top-growth?limit=5`。
- 话题分类：`GET /api/v1/queries/videos/with-metrics?metrics_mode=history`，在服务端按标题包含关键词过滤后汇总逐日增量；直播接口没有话题归属，因此话题分类卡不重复展示直播数据。

所有接口查询并发执行，日报结果短暂缓存 45 秒，以便卡片交互尽量稳定地在飞书的 3 秒响应窗口内完成。
每个读取请求都会携带 `Authorization: Bearer <INTERNAL_API_TOKEN>`；未配置 token 时服务会在启动期间立即报错。

## 管理 API

- `GET /healthz`：健康检查。
- `GET /api/bootstrap`：项目期次、机器人群聊与默认配置。
- `POST /api/reports/preview`：生成卡片 JSON，不发送。
- `POST /api/reports/send`：生成并发送卡片。
- `GET /api/schedules`：读取所有网页每日推送计划及下次执行时间。
- `POST /api/schedules`：新增每日推送计划。
- `PUT /api/schedules/:id`：完整更新每日推送计划。
- `PATCH /api/schedules/:id`：启用或停用计划。
- `DELETE /api/schedules/:id`：删除计划。

发送请求示例：

```json
{
  "chatIds": ["oc_xxx"],
  "periodIds": [53, 11, 10],
  "projectIds": [3, 2, 1],
  "mode": "combined",
  "rankingMode": "today",
  "topicKeywords": ["塔塔万圣捣蛋时刻", "养萌物来塔塔"],
  "showTrend": true,
  "enableForward": true,
  "enableForwardInteraction": false
}
```

`periodIds` 传空数组时，服务会自动选择 `projectIds` 指定项目的最大 `activity_period_id`；`projectIds` 也为空时选择全部项目的最新期次。每个 `topicKeywords` 条目会生成一份独立分类卡片。

## 校验与部署

```bash
bun run typecheck
bun test
docker build -t lark-project-daily-report .
docker run --env-file .env -p 3000:3000 lark-project-daily-report
```

仓库包含 [Docker GitHub Actions](.github/workflows/docker.yml)：

- Pull Request：执行类型检查、测试和多架构镜像构建，但不推送。
- 推送到默认分支、`v*` 标签或手动运行：构建 `linux/amd64` 与 `linux/arm64`，并推送至 Docker Hub 的 `<dockerhub-user>/<repository>`。
- 默认分支额外生成 `latest` 标签；版本标签会生成语义化版本标签。

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中配置：

- Secret `DH_TOKEN`：Docker Hub Personal Access Token，必填。
- Variable `DH_USERNAME`：Docker Hub 用户名；仅当 Docker Hub 用户名与 GitHub 仓库所有者不一致时配置。

服务器部署示例：

```bash
docker login -u <dockerhub-user>
docker pull <dockerhub-user>/<repository>:latest
docker run -d \
  --name daily-helper \
  --restart unless-stopped \
  --env-file /opt/daily-helper/.env \
  -v /opt/daily-helper/data:/app/data \
  -p 3000:3000 \
  <dockerhub-user>/<repository>:latest
```

服务器拉取私有 Docker Hub 镜像时需要先登录；公开镜像可直接拉取。服务端的真实 `.env` 不应提交到仓库。

生产环境请保证容器可访问互联网，以维持飞书 WebSocket 长连接，并且同一飞书应用只运行一个接收实例；飞书长连接采用集群消费，不会把同一个回调广播给所有实例。

## 应用日志

应用启动、HTTP 请求、飞书连接、计划推送和 A2 采集日志会同时输出到控制台和 `data/logs/app-YYYY-MM-DDTHH.log`。日志按 UTC 小时轮转，保留当前小时和前 47 个小时，过期文件在启动或换小时后自动删除。容器部署请挂载 `data/`，以便重启后仍能读取保留期内的日志。

A2 逐步日志以 `[debug]` 开头，记录每款游戏的飞书日期核对、待补日期、云图页面加载、每次请求的耗时和重试，以及飞书写入结果。云图页面导航和单次数据请求的超时均为 60 秒。设置 `A2_DEBUG=false` 可同时关闭控制台和文件里的 A2 逐步日志，采集汇总和最终错误仍会记录。日志不记录请求体、云图 Cookie 或访问令牌。

出现采集错误时，可用网页或插件提示的运行编号在 `data/logs/` 中搜索 `run_id=<运行编号>`。自动采集最近一次运行编号保存在状态接口的 `lastRunId`。同一轮日志包含 `stage`、`game`、`date`、`attempt`、`duration_ms` 和错误分类 `code`。云图请求还记录浏览器观察到的请求数、HTTP 状态、内容类型和网络错误码，飞书 API 错误记录 HTTP 状态和飞书提供的追踪编号。`requests_seen=0` 表示监听期间没有观察到与这次采集匹配的请求。

## 云图 A2 日采集与配套扩展

北京时间当天第一条日报成功发送后，以 T−2 为数据截止日期。程序分页读取五款游戏各自的飞书表，按从新到旧的顺序补齐从各表最早已有日期到截止日期之间的所有缺口。比如 11 月 24 日的截止日期是 11 月 22 日，如果表里已有 11 月 19 日和 21 日，则补 22 日和 20 日。空表从 T−2 开始，更早的日期可以指定起点手动回填。后续日报会重试，已在飞书表里的日期不会重复写。当日全部核对成功后，重启也不会重复采集。自动计划、网页发送和机器人指令共用此逻辑，预览不触发。单实例运行并挂载 `data/` 持久卷。

目标知识库为 `https://lilithgames.feishu.cn/wiki/V1vYwn6OxiayQlkajqWcSVLNnpc`。目标 Wiki 节点必须是多维表格，现有飞书自建应用必须拥有 Wiki 节点读取、多维表格表/字段/记录读写权限，并作为协作者有目标资源编辑权限。代码不会替换或删除现有表；同名表字段类型冲突或日期重复时停止该游戏写入。

| 表名 | aadvid |
|---|---|
| 战火勋章 | 1753459094831118 |
| 小冰冰传奇 | 1775180790896781 |
| 万国觉醒 | 1715399349333006 |
| 万龙觉醒 | 1793391127052291 |
| 塔塔冒险队 | 1870863252827667 |

每表包含 `日期`（日期字段，按北京时间零点保存）、`A2`（数字，千分位无小数，`a2.cover_num`）、`other_A2`（数字，千分位无小数，页面“其他品牌”的 `a2.count_average`，不是 `industry_avg`）。自动按日期更新已有行，无则新增；现有两列表会自动补建 `other_A2`。

配置参考 `.env.example`：保持原有 `LARK_APP_ID/LARK_APP_SECRET` 即可使用 A2 日报与插件上传。插件上传不需要令牌；`A2_UPLOAD_TOKEN` 仅保护手动采集、历史回填及管理状态接口。Linux 安装 Chromium 并设置 `CHROMIUM_PATH`；Dockerfile 已包含 Chromium。只有容器无 sandbox 时使用 `CHROMIUM_NO_SANDBOX=true`。Cookie 仅保存在 `data/a2/auth.json`，不进入 Git、不返回给状态查询；请保护该持久卷。

扩展加载目录为 `extension/a2`，支持 Chrome/Edge 开发者模式的“加载已解压的扩展程序”。默认上传域名是 `https://daily.lilith.ali.trih.top/`，测试时改为测试域名或 `http://127.0.0.1:3000`，浏览器会申请该域名权限。插件不再包含令牌输入框；上传协议和请求结构由服务端严格校验。

本地真实联调步骤：

1. `bun install --frozen-lockfile`；设置 `CHROMIUM_PATH` 为本地 Chrome/Edge 可执行文件，设置 `A2_UPLOAD_TOKEN`。
2. 本地启动前设置 `AUTO_DAILY_REPORT_ENABLED=false`、`LARK_LONG_CONNECTION_ENABLED=false`，避免测试启动时发送已有自动日报；网页计划若已存在，使用独立的 `SCHEDULES_FILE=data/local-schedules.json`。执行 `bun run dev`。
3. 扩展服务器填写 `http://127.0.0.1:3000`，无需填写令牌。在云图登录，依次访问五款游戏的“人群资产”页，等待数据加载。扩展仅监听两个只读 API 模板，保存品牌 ID 和必要的 `x-industry-version/x-path-id` 请求头。
4. 点击“上传登录态”；在独立的 `/a2` 页面预览和发送 A2 日报，A2 日报仅读取多维表。此操作会写入配置的目标飞书；若需要隔离测试数据，将 `A2_WIKI_TOKEN` 指向专用测试 Base 的 Wiki 节点。
5. 登录失效时重新登录并上传。缺少游戏的请求模板、无有效数值或鉴权失败不会填零。`other_A2` 不会用行业均值替代。

插件免令牌上传接口：`POST /api/a2/auth`，要求 JSON，`X-A2-Upload: yuntu-session-v1` 为可选协议标记（兼容不发送该头的旧插件），严格校验 Cookie 域、请求 URL、五个已配置 aid、品牌 ID、请求头白名单和重复模板，拒绝额外字段。受保护管理接口：`GET /api/a2/status` 状态、`POST /api/a2/collect` 手动采集、`POST /api/a2/backfill` 历史回填（JSON：`{"start":"2026-01-01","end":"2026-11-15"}`，end 不填则为北京时间 T−2），均需要 `Authorization: Bearer <A2_UPLOAD_TOKEN>`。不配置令牌时接口不可访问。

验证：本地 Bun 测试覆盖时间偏移、整数解析、五游戏采集、重启/并发去重、失败重试、飞书分页与日期更新及上传鉴权；本地真实 Chromium 已完成启动 smoke test。2026-11-17 已使用上传登录态在本地 Windows Chromium 完成五游戏 T−2/T−3 共 10 条真实采集，结果见本地 `data/a2-source-test/observations.json`。补齐 `sessionid_ss` 的同会话 `sessionid` 兼容名可恢复登录，已有 `sessionid` 保留不变。应用权限及 Wiki 协作权限已补齐；2026-11-17 已完成五表重建、2026-01-01 至 2026-11-15 每表 319 天共 1,595 条历史写入，全部日期与数值读回核验通过。Linux 运行环境仍待部署联调：采集器运行原站页面后发出新日期请求，不重放过期的 `X-Bogus/_signature`，若原站签名中间件不处理该请求，会明确失败，需要再适配该原站调用链。

历史回填按 90 天连续分段，首段 2026-01-01 至 2026-03-31，查询 date=20260331、card=2、benchmark=1。每段缓存落盘，可断点重试；每表以日期为键按 100 条批量新增/更新，全部分页读回核对数值与日期唯一性。不会为缺失日期伪造零。`A2` 与 `other_A2` 使用飞书格式枚举 `1,000`（千分位无小数）；HTTP 状态查询中的 `history` 包含回填进度。数据缓存保存在 `A2_DATA_DIR/history/<start>_<end>/`。

每张游戏表另有 `游戏` 文本列，保存中文游戏名（战火勋章、小冰冰传奇、万国觉醒、万龙觉醒、塔塔冒险队），便于汇总后按游戏分组作图。日常及历史写入均自动填充；`A2Base.populateGame` 可按100条批次仅补齐此列并核对原日期及两个指标保持不变。

## 独立 A2 日报

访问 `/a2`，在项目日报之外独立选择游戏、群聊与定时计划。日报只包含战火勋章、万国觉醒、万龙觉醒、塔塔冒险队，不包含小冰冰传奇。只选一款时展示近15天游戏 A2 折线及其他品牌 A2 面积图，左右轴明确标注；选多款时一张紧凑卡片展示最新规模、较前日/7日前变化。数值、增减量和图轴统一使用万，变化比例用百分比。数据延迟或缺日会显示实际日期，不补零或冒用上一条作为昨日。

A2 的预览/发送与计划接口位于 `/api/a2/reports/`，不依赖星图接口；计划持久化到 `A2_SCHEDULES_FILE`（默认 `A2_DATA_DIR/report-schedules.json`），与项目日报计划独立。A2 预览、即时发送和定时计划仅从飞书多维表读取数据，不触发云图采集；日报始终标注实际数据日期。卡片底部“看板及数据”按钮在电脑、iOS、Android 均打开指定 Wiki 看板。

A2 网页与浏览器插件的「从云图重新拉取」使用服务器上的云图登录态重新采集五款游戏 T−2 的数据，补齐缺失日期并写入飞书。网页在完成后更新所选游戏的预览。手动拉取需服务器配置 `A2_UPLOAD_TOKEN`，并在入口输入该令牌；应用不会保存输入的令牌。插件升级到 1.1.3 后请在扩展管理页重新加载，上传登录态仍只需服务器地址。

A2 卡片支持在整体概览和本次所选游戏之间切换，并固定发送时的数据截止日期，互动有效期14天。默认允许转发及转发后交互；通过原有飞书长连接按 `a2_switch` 分流回调，慢查询异步更新卡片。战火勋章灰、万国觉醒金、万龙觉醒红、塔塔冒险队紫；涨红跌绿。对比占比为本游戏A2/其他品牌A2，按0–20%、20–40%、40–60%、60–80%、80%及以上分档，超过100%不截断实际数值。页脚仅复用正常日报的联系人组件并显示互动截止时间。

私聊机器人发送 `a2`（大小写不敏感，允许首尾空白）默认回复选中万国觉醒的标准 A2 卡片，可通过下拉选择切换四款游戏或整体概览，仅从多维表读取，保留游戏切换、看板链接、转发及转发后交互；群聊中的该口令不触发，重复事件按消息ID去重。需要正式实例已启用长连接并订阅 `im.message.receive_v1`，与现有私聊日报指令共用消息入口。

A2 发送（包括私聊 `a2` 口令）先立即投递一张“正在读取 A2 数据”的小卡片，随后读取多维表并通过 CardKit 更新原消息为标准卡片，不额外发送第二条；读取失败时原消息更新为失败提示。

私聊 `a2` 默认进入万国觉醒，并保留四游戏发送范围；初始仅读取万国觉醒的数据。A2 卡片使用 `select_static` 下拉切换，回调读取 `action.option`，同时兼容旧按钮卡片。单游戏按规模、对比占比和日/7日涨跌分块；汇总按游戏、游戏A2/其他品牌、日/7日变动、占比分列展示，避免长段落拥挤。

## 群聊与用户定时推送

项目日报 `/` 和 A2 日报 `/a2` 均使用统一收件人选择器。可以切换群聊/用户、按名称或 ID 搜索、全选当前搜索结果，或手动批量填写 ID；一个计划最多 500 个收件人，可以混合选择群聊与私聊。计划保存所选目标的快照，后续新增用户或群聊需编辑计划加入。需要不同时间或不同内容时分别建计划。保存前可取消“保存后启用”。

群聊列表限机器人所在群；其他群需先添加机器人。用户列表通过 `GET /api/recipients/users` 只读取这些群的用户成员，按 open_id 跨群去重，不调用企业通讯录。首次切换到用户时加载，缓存5分钟，点击刷新会重新读取群聊和成员。需具备群聊列表读取及 `im:chat.members:read` 群成员读取权限，无需通讯录权限。列表仅返回姓名和 open_id，不含机器人；部分群读取失败或受安全配置限制时明确提示列表不完整。也可手动填写当前应用的用户 open_id。

发送和计划 API 支持 `recipients: [{"type":"chat","id":"oc_xxx"},{"type":"user","id":"ou_xxx"}]`。普通日报计划使用 `/api/schedules`，A2 使用 `/api/a2/reports/schedules`（顶层 gameCodes）；两类计划分别保存。旧版 `chatId` 计划、`chatIds` 即时发送仍兼容。用户投递采用 `receive_id_type=open_id`，不进行群成员检查；能否投递受应用可用范围及飞书权限约束。单个目标失败会继续投递其余目标，并将失败目标摘要记录在计划运行结果中。

普通日报私聊继续禁止转发。A2 私聊计划在所选游戏包含万国觉醒时默认展示万国觉醒，保留所选游戏下拉范围和允许转发、转发后交互的行为；群聊多游戏计划默认展示概览。A2 群聊和私聊均先发送读取小卡片再更新原消息，A2 计划只读多维表。
