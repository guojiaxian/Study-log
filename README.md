# StudyLog · 初中生学习成绩记录系统

面向单个家庭自用的成绩管理工具：把每次考试的分数录进去，自动算出总分、得分率、排名进退与目标院校差距，并给出趋势图与 AI 学情分析。目标场景是 **2027 年中考（初三）**，因此所有统计口径都以中考为准（总分满分 730）。

- 单用户自用，**应用内无登录、无口令**，打开即用；如需限制访问请从部署层处理。
- 数据落在单个 SQLite 文件里，无独立数据库进程；整机在 2 核 2GB 上可轻松运行。

## 功能

| 页面 | 说明 |
| --- | --- |
| 首页 | 最近考试概览、关键指标卡片 |
| 趋势分析 | 单科/总分走势、得分率与排名变化，图表支持断点与反向 Y 轴 |
| 历史成绩 | 考试列表与单次考试详情（各科得分、满分、排名） |
| 智能分析 | 基于统计摘要生成学情分析报告（纯中文输出） |
| 目标院校 | 目标学校与录取线维护、当前分差对比 |
| 管理 | 手动录入、智能批量录入（粘贴成绩文本由大模型解析）、科目/考试类型/数据备份等设置 |

## 技术栈

- **后端**：Node.js ≥ 22.5 + Fastify 4，单进程同时提供 REST 接口与前端静态资源
- **数据库**：SQLite + WAL，驱动为 Node 内置 `node:sqlite`（免原生编译、无额外系统依赖）
- **前端**：Vue 3 + Vite 5 + Vue Router + Pinia + ECharts（按需引入），原生 CSS
- **大模型**：OpenAI 兼容协议，默认 DeepSeek；密钥仅存于服务端 `.env`，不下发前端
- **进程守护**：systemd（生产）；开发环境直接 `node --watch`

## 目录结构

```
studylog/
├── server/               # 后端
│   ├── src/
│   │   ├── app.js        # Fastify 装配：插件、路由、错误处理、静态托管
│   │   ├── server.js     # 入口：监听、优雅退出、AI 连通性自检
│   │   ├── db/           # 连接与 PRAGMA 调优、迁移执行器、migrations/*.sql
│   │   ├── routes/       # 各资源路由（health / subjects / exams / ai / stats ...）
│   │   ├── services/     # 业务逻辑（考试、统计、AI、院校、配置、数据）
│   │   └── lib/          # 纯函数：指标计算、科目匹配、规则分析、AI 输出解析
│   ├── scripts/          # seed-demo.js 演示数据
│   └── test/             # Vitest 单元测试
├── web/                  # 前端（构建产物 web/dist，由后端托管）
├── data/                 # 运行时数据：SQLite 主库 + WAL（不入 Git）
├── backups/              # 备份（不入 Git）
├── logs/                 # 运行日志（不入 Git）
├── deploy/
│   ├── deploy.sh         # 一键部署脚本
│   └── studylog.service  # systemd 单元文件
├── studylog.sh           # 手动管理服务（start/stop/restart/status/log）
└── .env.example
```

## 快速开始（开发）

```bash
# 1) 安装依赖（server + web）
npm run setup

# 2) 配置环境变量
cp .env.example .env
#    填入 AI_API_KEY；模型与 token 预算见下方「环境变量」

# 3) 初始化数据库并灌入演示数据（可选，10 次考试）
npm run migrate
npm run seed:demo

# 4) 启动后端（http://127.0.0.1:3000）
npm run dev

# 5) 另开一个终端启动前端开发服务器（http://127.0.0.1:5173，已代理 /api 到 3000）
npm --prefix web run dev
```

也可以直接用 [studylog.sh](studylog.sh) 管理本地服务：

```bash
./studylog.sh start | stop | restart | status | log [N]
```

## 生产构建与运行

```bash
npm run setup          # 安装依赖
npm run build          # 构建前端到 web/dist，由 Fastify 直接托管
npm start              # 启动服务（等价于 node server/src/server.js）
```

启动时会自动执行数据库迁移（失败则拒绝启动），因此无需单独跑迁移命令。

## 环境变量

配置全部通过 `.env` 注入，生产环境由 systemd `EnvironmentFile` 加载；`loadEnv.js` 只在变量缺失时兜底读取项目根目录 `.env`。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | 是 | `production` | 运行模式 |
| `PORT` | 否 | `3000` | 监听端口 |
| `HOST` | 否 | `0.0.0.0` | 监听地址；启用反向代理时建议改 `127.0.0.1` |
| `DB_PATH` | 否 | `./data/studylog.db` | SQLite 文件路径（相对进程工作目录） |
| `AI_PROVIDER` | 否 | `deepseek` | `deepseek` / `openai` / 自定义 |
| `AI_BASE_URL` | 否 | `https://api.deepseek.com/v1` | OpenAI 兼容 Base URL |
| `AI_API_KEY` | 否 | — | 大模型密钥；留空则 AI 能力降级为手动录入 + 规则分析 |
| `AI_MODEL` | 否 | `deepseek-chat` | 本项目实际使用 `deepseek-flash` |
| `AI_TIMEOUT_MS` | 否 | `20000` | 外呼超时；推理型模型建议 ≥ 60000 |
| `AI_MAX_TOKENS_PARSE` | 否 | `4000` | 成绩解析最大输出 token |
| `AI_MAX_TOKENS_ANALYSIS` | 否 | `12000` | 学情分析最大输出 token |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `LOG_RETAIN_DAYS` | 否 | `14` | 日志保留天数 |
| `BACKUP_RETAIN_COUNT` | 否 | `30` | 备份保留份数 |
| `TZ` | 是 | `Asia/Shanghai` | 时区 |

> **推理模型的 token 预算**：`deepseek-flash` 会先消耗大量 reasoning token 再产出正文，预算不足会导致 JSON 截断或返回空内容。若解析/分析报「输出被截断」，优先调大 `AI_MAX_TOKENS_PARSE` / `AI_MAX_TOKENS_ANALYSIS`。

## 部署（裸机 + systemd）

默认拓扑：公网 → Node.js（Fastify，systemd 守护），同一进程既提供 `/api/v1/*` 接口，也托管 `web/dist` 静态页，不引入 Nginx。

```bash
# 服务器一次性初始化
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git curl

sudo mkdir -p /opt/studylog && sudo chown "$USER" /opt/studylog
git clone https://github.com/guojiaxian/Study-log.git /opt/studylog
cd /opt/studylog
cp .env.example .env && chmod 600 .env      # 填入 AI_API_KEY
mkdir -p logs

sudo cp deploy/studylog.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now studylog
sudo ufw allow 3000/tcp                     # 云厂商安全组同样需放行

# 之后每次发版
bash deploy/deploy.sh
```

部署脚本会依次执行：校验 Node 版本 → 对齐远端分支 → `npm ci` → 构建前端 → 重启 systemd → 健康检查。

注意事项：

- systemd 单元里 `ExecStart=/usr/bin/node` 是绝对路径，因此请用**系统级安装**的 Node（NodeSource / 发行版包），不要用 nvm。
- `WorkingDirectory` 与 `EnvironmentFile` 用的是绝对路径（默认 `/opt/studylog`）。想放到别的目录（含 home）时，需要同步改这三处：`deploy/studylog.service` 的 `WorkingDirectory` / `EnvironmentFile`、`deploy/deploy.sh` 的 `APP_DIR`。
- 应用无鉴权，公网直开端口意味着任何能访问该端口的人都能读写数据；建议用安全组限制来源 IP，或在前面加 Nginx 做 Basic Auth / HTTPS。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run setup` | 安装 server 与 web 依赖 |
| `npm run build` | 构建前端到 `web/dist` |
| `npm start` | 生产模式启动 |
| `npm run dev` | 开发模式启动（`node --watch`） |
| `npm run migrate` | 单独执行数据库迁移 |
| `npm run seed:demo` | 灌入演示数据（10 次考试） |
| `npm test` | 运行 Vitest 单元测试 |
| `bash deploy/deploy.sh` | 服务器上一键发版 |

## 接口约定

- 所有接口前缀 `/api/v1`，响应统一为 `{ code, message, data }`；成功 `code = 0`。
- 健康检查：`GET /api/v1/health` → `{ status, dbReady, rssMb, uptimeSec, version, time }`，免鉴权，可用于外部探活。
- 错误码表与完整报文契约见 [docs/02-开发手册.md](docs/02-开发手册.md) 第 5 章，大模型契约见第 6 章。

## 数据与备份

- 主库 `data/studylog.db`，WAL 模式；`PRAGMA cache_size` / `mmap_size` 按 2GB 内存预算收紧。
- 迁移前会自动对数据库做一次快照（`*.bak.NNN`）。
- `data/`、`backups/`、`logs/`、`.env` 均不入 Git；换机器时只需带走 `.env` 与 `data/studylog.db`。

## 文档

- [产品设计手册](docs/01-产品设计手册.md)
- [开发手册](docs/02-开发手册.md)（DDL、接口报文、AI 契约、线上低配适配）

## 开发约定

- 派生指标（总分、Δ、均值、连续下滑、名次进退、中考口径总分、目标差距）统一实现为 `server/src/lib/metrics.js` 中的纯函数，前端不得自行实现另一套口径。
- 涉及多次写入的操作（建考试 + 写成绩 + 写排名、批量导入、覆盖恢复）必须包在 `db.transaction()` 中。
- 路由层只做校验与调用服务层；服务层不处理 HTTP 相关逻辑。
- 数据库字段 `snake_case`，JS 变量 `camelCase`，接口路径 `kebab-case` 复数资源。
