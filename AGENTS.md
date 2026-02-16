# AGENTS.md - AI-Tunnel 项目上下文

> 供所有参与开发的 AI Agent 共享的项目信息。

## 项目概述

跨平台 API 反向代理 + SSH 隧道工具。在本地电脑运行，通过 SSH 反向隧道将 API 请求从远程服务器路由到本地，再由本地转发到目标 API。

## 架构

```
远程服务器 localhost:remotePort
    ↓ SSH 反向隧道
本地 localhost:localPort (反代)
    ↓ HTTPS 请求
目标 API 站点
```

## 技术栈

- **Runtime**: Node.js >= 18（ESM 模块）
- **SSH**: `ssh2` 库（纯 JS，无需系统 SSH 客户端）
- **配置**: `js-yaml`
- **HTTP**: Node.js 原生 `http` / `https` 模块
- **无框架**：不用 express/koa，保持轻量

## 项目结构

```
ai-tunnel/
├── src/
│   ├── index.mjs      # 主入口，启动反代 + 隧道
│   ├── cli.mjs        # CLI 命令行入口
│   ├── config.mjs     # YAML 配置加载与验证
│   ├── proxy.mjs      # HTTP 反向代理（转发到目标 API）
│   └── tunnel.mjs     # SSH 反向隧道管理
├── tunnel.config.example.yaml  # 配置模板
├── package.json
└── README.md
```

## 关键设计决策

1. **ESM only** — 全部用 `.mjs`，不用 CommonJS
2. **纯 JS SSH** — 用 ssh2 库，不依赖系统 SSH 客户端，确保跨平台
3. **每个站点独立端口** — 避免路径冲突，简化配置
4. **零框架** — 原生 Node.js http 模块，减少依赖

## 已知问题（待修复）

- [ ] tunnel.mjs 里 `await_import` 用了 `require`，ESM 不兼容
- [ ] 不支持 SSE（Server-Sent Events）流式响应 — AI API 必需
- [ ] 没有 graceful shutdown
- [ ] 没有请求日志
- [ ] SSH keepalive 可能假死

## 配置格式

```yaml
ssh:
  host: "server-ip"
  port: 22
  username: "root"
  privateKeyPath: "~/.ssh/id_rsa"  # 或 password: "xxx"

sites:
  - name: "站点名"
    target: "https://目标域名"
    localPort: 8080        # 本地反代端口
    remotePort: 9090       # 远程映射端口
    healthCheck: "/v1/models"  # 可选：健康检查路径

settings:
  reconnectInterval: 5000
  healthCheckInterval: 60000
  logLevel: "info"
```

## 开发规范

- Commit message 用 conventional commits（feat/fix/docs/refactor）
- 改动通过 PR 合并，不直接推 main
- 代码注释用英文，README / 文档中英都行
- 新功能先开 issue 讨论

## Roadmap

### P0 - MVP
- 多站点反代 + SSH 隧道 + 自动重连 + 配置文件

### P1 - 稳定可用
- SSE 流式支持、健康检查、日志、graceful shutdown
- npm publish

### P2 - 进阶
- 终端 dashboard、多 VPS、配置热重载、WebSocket、Docker
