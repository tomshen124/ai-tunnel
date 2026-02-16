# AGENTS.md - AI-Tunnel 项目上下文

> 供所有参与开发的 AI Agent 共享的项目信息。

## 项目概述

跨平台 API 隧道代理网关。统一入口 + 多通道智能路由 + 自动故障转移 + Web UI。

通过 SSH 反向隧道将 API 请求从远程 VPS 路由到本地电脑，再由本地转发到目标 API，绕过 CF 拦截。

## 架构（v2）

```
VPS 应用 → localhost:9000（统一入口）
                ↓
          Router Engine
     (策略选择 + Key 轮换 + 重试)
                ↓
          Channel Pool
     [ch-A: 3 keys] [ch-B: 1 key]
                ↓
          SSH Tunnel (可选)
                ↓
          目标 API 站点
```

Web UI 运行在 `:3000`，通过 REST API + SSE 管理和监控。

## 技术栈

- **Runtime**: Node.js >= 18（ESM 模块）
- **SSH**: `ssh2` 库（纯 JS，无需系统 SSH 客户端）
- **配置**: `js-yaml`
- **HTTP**: Node.js 原生 `http` / `https` 模块
- **UI**: htmx + Tailwind CDN（单 HTML 文件，零构建）
- **无框架**：不用 express/koa，保持轻量
- **零额外依赖**：只有 ssh2 + js-yaml

## 项目结构

```
ai-tunnel/
├── src/
│   ├── index.mjs      # v2 主入口（整合所有模块）
│   ├── cli.mjs        # CLI 命令行入口
│   ├── config.mjs     # 配置加载 + v1 兼容转换 + 热重载
│   ├── channel.mjs    # Channel 管理（Key 池、健康状态、统计）
│   ├── router.mjs     # 路由引擎（priority/round-robin/lowest-latency）
│   ├── proxy.mjs      # 统一反向代理（接入 router + 重试）
│   ├── retry.mjs      # 重试逻辑（指数退避、Key/Channel 级别判断）
│   ├── health.mjs     # 定期健康检查
│   ├── tunnel.mjs     # SSH 反向隧道管理
│   ├── logger.mjs     # 日志 + 事件总线（供 SSE 订阅）
│   ├── api.mjs        # Web API 层（REST + SSE）
│   └── ui/
│       └── index.html  # Web UI（CC-Switch 风格，暗色主题）
├── docs/
│   └── V2_DESIGN.md   # v2 完整设计文档
├── tunnel.config.example.yaml
├── package.json
├── AGENTS.md           # 本文件
└── README.md
```

## 关键设计决策

1. **ESM only** — 全部 `.mjs`，不用 CommonJS
2. **纯 JS SSH** — 用 ssh2 库，跨平台无系统依赖
3. **统一入口端口** — `:9000`，替代 v1 的多端口模式，对上层应用透明
4. **Router Engine** — 策略驱动（priority/round-robin/lowest-latency），故障自动转移
5. **Key 池** — 每个 channel 多 Key 轮换，401/403 自动跳过失效 Key
6. **事件总线** — logger.mjs 内置 pub/sub，SSE 实时推送到 Web UI
7. **v1 兼容** — 旧的 `sites` 配置自动转换为 `channels`

## 路由策略

| 策略 | 行为 |
|------|------|
| `priority` | 按 weight 降序，非 fallback 优先，故障时降级 |
| `round-robin` | 轮询均衡 |
| `lowest-latency` | 选最近延迟最低的 channel |

## 重试逻辑

- 429 → 换 Key 重试
- 401/403 → 标记 Key 失效，换 Key
- 502/503/504 → 换 Channel 重试
- 指数退避 + 抖动，防雪崩
- 连续 3 次失败标记 channel 为 unhealthy

## API 端点

```
GET  /api/status              — 全局状态
GET  /api/channels            — 通道列表 + 状态
POST /api/channels/:name/toggle — 启用/禁用
POST /api/channels/:name/keys  — 添加 Key
DEL  /api/channels/:name/keys/:i — 删除 Key
GET  /api/logs                — SSE 实时日志
GET  /api/logs/recent         — 最近日志
GET  /api/stats               — 统计
POST /api/config/reload       — 手动重载配置
GET  /                        — Web UI
```

## 开发规范

- Commit message 用 conventional commits（feat/fix/docs/refactor）
- 改动通过 PR 合并，不直接推 main
- 代码注释用英文，文档中英都行
- 不新增 npm 依赖，前端走 CDN

## 当前状态

- ✅ v2 核心功能全部实现
- ✅ Web UI 完成（CC-Switch 风格）
- ✅ 设计文档在 docs/V2_DESIGN.md
- 🔲 测试 + 实际验证
- 🔲 npm publish
- 🔲 Docker 支持
