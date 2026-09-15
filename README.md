# 飞书项目每日快报

基于 Bun、TypeScript 与 [`@larksuiteoapi/node-sdk`](https://github.com/larksuite/node-sdk) 的飞书日报服务。数据来自星图工作流服务的 [OpenAPI 3.1 规范](https://autoxingtu.api.ali.trih.top/api-doc/openapi.json)。

## 已实现

- 默认按 `project_id` 分组，只取数值最大的 `activity_period_id`。多合一日报初始聚焦 `PROJECT_ORDER` 顺位第一个项目，点击“所有项目”后展开全部项目。
- 同时展示本期累计与今日、昨日新增：视频播放、点赞、评论、稿件、作者，以及直播曝光、平均 ACU、场次、主播。
- 使用 `/api/v1/queries/videos/top-growth` 展示每项目 5 条今日或本期播放增长最快的视频。
- 卡片 JSON 2.0，下拉框只列出每个项目最大的期次；“所有项目 / 今日增长 / 本期增长”在宽屏同排展示、窄屏自动换行。“所有项目”使用紧凑视图避免超过飞书组件上限，视频标题可点击打开抖音播放页，并通过 `card.action.trigger` 长连接在 3 秒内立即返回新卡片。
- 网页读取当前机器人所在群聊，可配置多合一或单独日报、勾选项目、切换期次、预览并发送。
- 环境变量指定默认自动发送群，Cron 定时发送所有项目的最新期次。
- 单独日报使用接口返回的 `period` 作为标题，发布为无切换控件的静态卡片；项目 1/2/3 分别使用金色（飞书 `yellow`）、紫色和绿色主题。

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
```

常用配置：

| 变量                           | 默认值                                | 说明                                                  |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------- |
| `XINGTU_API_BASE`              | `https://autoxingtu.api.ali.trih.top` | 星图 API 根地址                                       |
| `XINGTU_API_TOKEN`             | 空                                    | 可选 Bearer Token                                     |
| `PROJECT_ORDER`                | 空                                    | project_id 展示顺序，如 `3,1,2`；未列出的项目自动追加 |
| `COLOR`                        | 空                                    | 项目主题色，如 `1-yellow,2-purple,3-blue`；支持 `blue`、`wathet`、`turquoise`、`green`、`yellow`、`orange`、`red`、`carmine`、`violet`、`purple`、`indigo`、`grey` |
| `PORT` / `HOST`                | `3000` / `0.0.0.0`                    | 管理页监听地址                                        |
| `LARK_LONG_CONNECTION_ENABLED` | `true`                                | 是否接收卡片长连接回调                                |
| `AUTO_DAILY_REPORT_ENABLED`    | `true`                                | 是否启用自动日报                                      |
| `DAILY_REPORT_CRON`            | `0 9 * * *`                           | 每日发送 Cron（分、时、日、月、周）                   |
| `REPORT_TIMEZONE`              | `Asia/Shanghai`                       | 今日口径和定时任务时区                                |

未配置飞书凭证时，服务仍可启动，项目数据、管理页和卡片预览可用；读取群聊、实际发送和长连接会停用。

## 飞书应用配置

1. 在飞书开发者后台启用机器人能力。
2. 为应用开通发送消息和读取群聊所需权限（至少包含 `im:message:send_as_bot` 与群聊读取权限），发布应用版本，并把机器人加入目标群聊。
3. 在 **事件与回调 → 回调配置** 中选择 **使用长连接接收回调**。
4. 添加新版 **卡片回传交互** 回调：`card.action.trigger`。不要同时保留旧版回调，避免一次点击收到两次请求。
5. 配置 `.env` 后重启服务。日志出现“卡片回调长连接已就绪”即接入成功。

卡片点击后使用“方式一”立即更新：处理器并发查询所需汇总与 Top 5，并直接在长连接响应中返回 `{ toast, card: { type: "raw", data } }`，不依赖公网 Webhook。

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
  "rankingMode": "today"
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
