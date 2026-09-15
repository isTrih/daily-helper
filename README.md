# 飞书项目每日快报

基于 Bun、TypeScript 与 [`@larksuiteoapi/node-sdk`](https://github.com/larksuite/node-sdk) 的飞书日报服务。数据来自星图工作流服务的 [OpenAPI 3.1 规范](https://autoxingtu.api.ali.trih.top/api-doc/openapi.json)。

## 已实现

- 默认按 `project_id` 分组，只取数值最大的 `activity_period_id`。多合一日报初始聚焦 `PROJECT_ORDER` 顺位第一个项目，点击“所有项目”后展开全部项目。
- 本期累计展示视频播放、稿件、作者，以及直播 PV、场次、主播；今日与昨日的视频播放使用接口单日增量，新增稿件和新增作者按相邻日期存量差值计算，同时展示直播场次和参与主播，不计算直播 PV 日增。日增指标为零时隐藏对应指标卡；若本期累计没有直播数据，则隐藏全部直播板块。
- 使用 `/api/v1/queries/videos/top-growth` 展示每项目 5 条今日、昨日或本期播放增长最快的视频。
- 卡片 JSON 2.0，下拉框及“所有项目”只允许访问发送时选定的项目期次，旧卡片不会自动开放后来新增的期次；“所有项目 / 今日 TOP / 昨日 TOP / 本期 TOP / 折叠按钮组”在宽屏同排展示、窄屏自动换行。“所有项目”使用紧凑视图避免超过飞书组件上限，视频标题可点击打开抖音播放页。卡片交互会立即返回加载卡，再由后台取数并更新原消息，避免查询超时导致回调失败。
- 单期卡片可显示最近最多 31 天的全宽数据趋势：每日视频播放使用左轴面积图，新增稿件和新增作者使用右轴折线图，并使用项目主题的衍生色系。
- 顶部操作区的折叠按钮组可显示或隐藏单期趋势图、将日报收起为精简版本并重新展开；撤回操作会进入确认卡片，确认后调用飞书消息撤回接口，取消则恢复此前视图。
- 互动卡片采用两行页脚，第二行展示“卡片可互动有效期至 YY-MM-DD”；发送时同时锁定日报日期，后续切换、加载、收起和展开不会改变每日、累计、趋势或 TOP 的数据日期，历史日报改用具体月日标注。
- 网页读取当前机器人所在群聊，可配置多合一或单独日报、勾选项目及期次、排行口径、趋势图及卡片转发权限；同一个项目最多可同时选择两个期次，多合一模式会把同项目两期直接放在一张卡中。
- 环境变量指定默认自动发送群，Cron 定时发送所有项目的最新期次。
- 单独日报使用接口返回的 `period` 作为标题，不显示项目、期次和排行切换控件，只在页脚保留收起、趋势图和撤回操作；项目 1/2/3 分别使用金色（飞书 `yellow`）、紫色和绿色主题。
- 群聊中 `@机器人` 后发送“发送数据”或“巴拉拉能量”，以及无需 @ 直接发送“巴拉拉能量”，都会发送所有项目最新一期；`巴拉拉能量 ROK&SAMO` 等指令可按任意符号分隔 `ROK`、`SAMO`、`D1`，并生成所选项目的多合一日报，项目码不区分大小写。

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
PROJECT_ORDER=3,1,2
COLOR=1-yellow,2-purple,3-blue,4-orange
ICON=1-img_v2_xxxxxxxxxxxxxxx,2-img_v2_xxxxxxxxxxxxxxx
```

常用配置：

| 变量                           | 默认值                                | 说明                                                  |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------- |
| `XINGTU_API_BASE`              | `https://autoxingtu.api.ali.trih.top` | 星图 API 根地址                                       |
| `XINGTU_API_TOKEN`             | 空                                    | 可选 Bearer Token                                     |
| `PROJECT_ORDER`                | 空                                    | project_id 展示顺序，如 `3,1,2`；未列出的项目自动追加 |
| `COLOR`                        | 空                                    | 项目主题色，如 `1-yellow,2-purple,3-blue`；支持 `blue`、`wathet`、`turquoise`、`green`、`yellow`、`orange`、`red`、`carmine`、`violet`、`purple`、`indigo`、`grey` |
| `ICON`                         | 空                                    | 项目标题图标，如 `1-img_v2_xxx,2-img_v2_yyy`；值为飞书图片的 `img_key`，未配置时使用默认图标 |
| `PORT` / `HOST`                | `3000` / `0.0.0.0`                    | 管理页监听地址                                        |
| `LARK_LONG_CONNECTION_ENABLED` | `true`                                | 是否接收卡片长连接回调                                |
| `AUTO_DAILY_REPORT_ENABLED`    | `true`                                | 是否启用自动日报                                      |
| `DAILY_REPORT_CRON`            | `0 9 * * *`                           | 每日发送 Cron（分、时、日、月、周）                   |
| `REPORT_TIMEZONE`              | `Asia/Shanghai`                       | 今日口径和定时任务时区                                |

未配置飞书凭证时，服务仍可启动，项目数据、管理页和卡片预览可用；读取群聊、实际发送和长连接会停用。

## 飞书应用配置

1. 在飞书开发者后台启用机器人能力。
2. 为应用开通发送消息和读取群聊所需权限（至少包含 `im:message:send_as_bot`；无 @ 指令还需要读取群内全部消息的 `im:message.group_msg` 权限），发布应用版本，并把机器人加入目标群聊。
3. 在 **事件与回调 → 回调配置** 中选择 **使用长连接接收回调**。
4. 添加新版 **卡片回传交互** 回调 `card.action.trigger`，以及 **接收消息** 事件 `im.message.receive_v1`。不要同时保留旧版卡片回调，避免一次点击收到两次请求。
5. 配置 `.env` 后重启服务。日志出现“卡片回调长连接已就绪”即接入成功。

卡片点击后先在长连接响应中返回加载卡；处理器在后台并发查询所需汇总与 Top 5，再调用飞书消息卡片更新接口替换原消息。取数失败时会显示可重新加载的错误卡，不依赖公网 Webhook。

卡片撤回仅适用于机器人自己发送、且仍在企业管理员配置的撤回时限内的消息；飞书拒绝撤回时，确认卡片会保留并显示失败提示。

## 数据口径

- 项目/期次：`GET /api/v1/queries/projects`，并用 `GET /api/v1/queries/periods` 补充追踪日期。
- 内容配置：`GET /api/v1/queries/contents`，按 `activity_period_id + content_type` 找到视频和直播的 `content_config_id`。
- 本期累计：从 `tracking_start_date` 查询至今天或 `tracking_end_date`（取较早者）。
- 今日新增：汇总接口使用 `date=今天`。
- 视频汇总：`GET /api/v1/queries/videos/summary`。
- 直播汇总：`GET /api/v1/queries/lives/summary`。
- 增长排行：`GET /api/v1/queries/videos/top-growth?limit=5`。

所有接口查询并发执行，日报结果短暂缓存 45 秒，以便卡片交互尽量稳定地在飞书的 3 秒响应窗口内完成。

## 管理 API

- `GET /healthz`：健康检查。
- `GET /api/bootstrap`：项目期次、机器人群聊与默认配置。
- `POST /api/reports/preview`：生成卡片 JSON，不发送。
- `POST /api/reports/send`：生成并发送卡片。

发送请求示例：

```json
{
  "chatIds": ["oc_xxx"],
  "periodIds": [53, 11, 10],
  "mode": "combined",
  "rankingMode": "today",
  "showTrend": true,
  "enableForward": true,
  "enableForwardInteraction": false
}
```

`periodIds` 传空数组时，服务会自动选择每个项目最大的 `activity_period_id`。

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
  -p 3000:3000 \
  <dockerhub-user>/<repository>:latest
```

服务器拉取私有 Docker Hub 镜像时需要先登录；公开镜像可直接拉取。服务端的真实 `.env` 不应提交到仓库。

生产环境请保证容器可访问互联网，以维持飞书 WebSocket 长连接，并且同一飞书应用只运行一个接收实例；飞书长连接采用集群消费，不会把同一个回调广播给所有实例。
