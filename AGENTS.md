# AGENTS.md - AI-Tunnel 项目上下文

> 供所有参与开发的 AI Agent 共享的项目信息。

## 项目概述

跨平台 API 隧道代理网关（v2）。通过 SSH 反向隧道将 VPS 上的 API 请求路由到本地电脑，绕过 Cloudflare 拦截。支持多通道冗余、Key 池轮换、智能路由和 Web UI。

## 架构（v2）

```
VPS 上的应用
    ↓ http://localhost:9000 (统一入口)
Router Engine
    ↓ 选择 channel + key (priority/round-robin/lowest-latency)
    ↓ 失败自动重试 + 故障转移
Channel Pool
    ↓ SSH 反向隧道 (可选)
本地反代
    ↓ HTTPS 请求
目标 API 站点 (绕过 CF)
```

Web UI 运行在 `:3000`，提供状态监控和通道切换。

## 技术栈

- **Runtime**: Node.js >= 18（ESM）
- **SSH**: `ssh2` 库（纯 JS，无需系统 SSH 客户端）
- **配置**: `js-yaml`
- **HTTP**: Node.js 原生 `http` / `https` 模块
- **Web UI**: htmx + Tailwind CDN（零构建，单 HTML 文件）
- **零框架**：不用 express/koa，保持轻量

## 项目结构

```
ai-tunnel/
├── src/
│   ├── index.mjs      # 主入口，整合所有模块
│   ├── cli.mjs        # CLI 命令行入口
│   ├── config.mjs     # 配置加载 + v1 兼容 + 热重载
│   ├── router.mjs     # 路由引擎（策略选择 + 故障转移）
│   ├── channel.mjs    # Channel 管理（Key 池 + 健康状态 + 统计）
│   ├── proxy.mjs      # 统一反向代理（接入 router + retry）
│   ├── tunnel.mjs     # SSH 反向隧道管理
│   ├── retry.mjs      # 重试逻辑（指数退避 + channel failover）
│   ├── health.mjs     # 定期健康检查
│   ├── api.mjs        # Web API 层 + SSE 推送
│   ├── logger.mjs     # 日志 + 事件总线（ring buffer + subscribe）
│   └── ui/
│       └── index.html  # Web UI（暗色主题切换面板）
├── docs/
│   └── V2_DESIGN.md   # v2 设计文档
├── tunnel.config.example.yaml
├── package.json
├── AGENTS.md          # 本文件
└── README.md
```

## 关键设计决策

1. **ESM only** — 全部 `.mjs`，不用 CommonJS
2. **纯 JS SSH** — 用 ssh2 库，跨平台
3. **统一入口** — 一个端口 `:9000`，内部路由分发，替代 v1 的多端口
4. **零框架** — 原生 Node.js http 模块
5. **零构建前端** — htmx + Tailwind CDN，不需要 webpack/vite
6. **事件驱动** — logger 内置事件总线，SSE 推送到 UI

## v2 核心模块说明

### router.mjs
- 接收请求路径，匹配路由组，选择 channel + key
- 三种策略：priority（权重优先）、round-robin（轮询）、lowest-latency（低延迟优先）
- 支持 glob 路径匹配：`/v1/**`

### channel.mjs
- 每个 channel 维护 key 池、健康状态、请求统计
- Key 轮换：round-robin 或 random
- Key 失败 3 次自动禁用，成功后恢复

### proxy.mjs
- 统一入口，接收所有请求
- 通过 router 选 channel，通过 retry 处理失败
- 请求 body 缓冲以支持重试重放
- 完整 SSE 流式透传

### retry.mjs
- 429 → 换 key 重试
- 401/403 → 标记 key 失败
- 502/503/504 → 换 channel 重试
- 指数退避 + jitter

### config.mjs
- 支持 v1（sites）和 v2（channels）两种格式，v1 自动转换
- fs.watchFile 实现热重载（500ms 防抖）

### api.mjs
- REST API 管理通道、Key、状态
- SSE 端点推送实时日志和事件
- 内嵌 static HTML 服务

## 配置格式（v2）

```yaml
server:
  port: 9000           # 统一代理入口
  ui:
    enabled: true
    port: 3000         # Web UI

ssh:                   # 可选
  host: "VPS_IP"
  username: "root"
  privateKeyPath: "~/.ssh/id_rsa"

channels:
  - name: "站点名"
    target: "https://目标域名"
    keys: ["sk-key1", "sk-key2"]
    keyStrategy: "round-robin"
    weight: 10
    fallback: false
    tunnel:
      enabled: true
      localPort: 8080
      remotePort: 9090
    healthCheck:
      path: "/v1/models"
      intervalMs: 60000

routes:                # 可选，默认所有请求走全部通道
  - path: "/v1/**"
    channels: ["ch1", "ch2"]
    strategy: "priority"

settings:
  hotReload: true
  retry:
    maxRetries: 3
    retryOn: [429, 502, 503, 504]
    backoff: "exponential"
```

## 开发规范

- Commit message 用 conventional commits（feat/fix/docs/refactor）
- 改动通过 PR 合并，不直接推 main
- 代码注释用英文，README / 文档中英都行
- 新功能先开 issue 讨论

## 版本历史

### v2.0.0（当前）
- 统一入口端口替代多端口
- 多通道冗余 + 自动故障转移
- Key 池轮换
- 智能路由（3 种策略）
- 智能重试 + 指数退避
- 健康检查
- 配置热重载
- Web UI（CC-Switch 风格切换面板）
- REST API + SSE 实时推送

### v1.0.0
- 基础 SSH 反向隧道 + 多站点反代
- SSE 流式支持
- 彩色日志
- 优雅关闭
