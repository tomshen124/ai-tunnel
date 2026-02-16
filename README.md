# AI-Tunnel

跨平台 API 隧道代理 —— 多通道智能路由、自动故障转移、简洁切换面板。

[![Tests](https://github.com/tomshen124/ai-tunnel/actions/workflows/test.yml/badge.svg?branch=feat/v2)](https://github.com/tomshen124/ai-tunnel/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@tomshen124/ai-tunnel.svg)](https://www.npmjs.com/package/@tomshen124/ai-tunnel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 问题背景

第三方 AI 模型 API 站点（OpenAI 兼容）启用了 Cloudflare Bot Management，对云服务器 IP 段的请求进行拦截：

- ✅ 本地电脑/家庭网络 → API 站点 **正常**
- ❌ 云服务器 (VPS) → API 站点 **被 CF 403 拦截**

## 解决方案

AI-Tunnel 在本地电脑运行，通过 SSH 反向隧道将请求从 VPS 中转到本地，再由本地出口访问目标 API。

```
VPS 上的应用 → localhost:9000（统一入口）
                    ↓ 路由引擎（选通道 + 选 Key）
              SSH 反向隧道
                    ↓
              本地反代 → 目标 API（住宅 IP，不被拦截）
```

## 核心功能

- **统一入口** — 一个端口 `:9000`，上层应用只需配一个地址
- **多通道冗余** — 多个 API 站点组成通道池，自动故障转移
- **API Key 池** — 每个通道配多个 Key，轮换使用，避免限流
- **智能路由** — Priority / Round-Robin / Lowest-Latency 三种策略
- **智能重试** — 429 换 Key，5xx 换通道，指数退避
- **健康检查** — 定期检测通道可用性，故障自动绕过
- **Web UI** — CC-Switch 风格简洁面板，实时状态 + 一键切换
- **配置热重载** — 改配置不用重启
- **SSE 流式** — 完整支持 AI API 的流式响应
- **SSH 隧道** — 自动建立、断线重连、心跳保活
- **零框架** — 纯 Node.js，不依赖 express/koa

## 安装

### npm 全局安装（推荐）

```bash
npm install -g @tomshen124/ai-tunnel
```

安装后即可使用 `ai-tunnel` 命令。

### npx 直接运行（无需安装）

```bash
npx @tomshen124/ai-tunnel start
```

### 从源码安装

```bash
git clone https://github.com/tomshen124/ai-tunnel.git
cd ai-tunnel
npm install
```

## 快速上手

### 1. 生成配置文件

```bash
# 使用 CLI
ai-tunnel init

# 或手动复制
cp tunnel.config.example.yaml tunnel.config.yaml
```

### 2. 编辑配置

```yaml
# tunnel.config.yaml
server:
  port: 9000
  host: "127.0.0.1"
  ui:
    enabled: true
    port: 3000

channels:
  - name: "my-api"
    target: "https://api.example.com"
    keys:
      - "sk-your-api-key-1"
      - "sk-your-api-key-2"
    keyStrategy: "round-robin"
    weight: 10

  - name: "backup-api"
    target: "https://backup.example.com"
    keys:
      - "sk-backup-key"
    weight: 5
    fallback: true

settings:
  hotReload: true
  retry:
    maxRetries: 3
    retryOn: [429, 502, 503, 504]
```

### 3. 启动服务

```bash
# 全局安装后
ai-tunnel start

# 或从源码
npm start

# 或直接运行
node src/index.mjs
```

启动后：
- **Proxy 入口：** `http://127.0.0.1:9000`
- **Web UI：** `http://127.0.0.1:3000`

### 4. 在应用中使用

将 AI 应用的 API Base URL 改为 `http://localhost:9000`：

```yaml
# 例如 OpenClaw 配置
providers:
  - baseURL: http://localhost:9000/v1
    apiKey: sk-your-key
```

```python
# 例如 Python OpenAI SDK
import openai
client = openai.OpenAI(
    base_url="http://localhost:9000/v1",
    api_key="sk-your-key"
)
```

## 配置说明

### 完整配置示例

```yaml
# ═══ 服务配置 ═══
server:
  port: 9000              # 统一代理入口
  host: "127.0.0.1"
  ui:
    enabled: true
    port: 3000            # Web UI 端口
    host: "127.0.0.1"

# ═══ SSH 连接（可选，不用隧道可删除）═══
ssh:
  host: "YOUR_VPS_IP"
  port: 22
  username: "root"
  privateKeyPath: "~/.ssh/id_rsa"
  # password: "your-password"

# ═══ API 通道 ═══
channels:
  - name: "primary"
    target: "https://api-site.com"
    keys:
      - "sk-key1"
      - "sk-key2"
    keyStrategy: "round-robin"     # round-robin | random
    weight: 10                     # 权重越高优先级越高
    tunnel:                        # SSH 隧道（可选）
      enabled: true
      localPort: 8080
      remotePort: 9090
    healthCheck:
      path: "/v1/models"
      intervalMs: 60000
      timeoutMs: 5000

  - name: "backup"
    target: "https://backup-api.com"
    keys:
      - "sk-backup-key"
    weight: 5
    fallback: true                 # 标记为备用通道

# ═══ 路由组（可选）═══
routes:
  - path: "/v1/**"
    channels: ["primary", "backup"]
    strategy: "priority"           # priority | round-robin | lowest-latency

# ═══ 全局设置 ═══
settings:
  reconnectInterval: 5000
  logLevel: "info"                 # debug | info | warn | error
  hotReload: true                  # 配置文件变更自动重载
  retry:
    maxRetries: 3
    retryOn: [429, 502, 503, 504]
    backoff: "exponential"         # exponential | fixed
    baseDelayMs: 1000
    maxDelayMs: 10000
```

### 配置项说明

| 配置 | 说明 | 默认值 |
|------|------|--------|
| `server.port` | 代理入口端口 | `9000` |
| `server.ui.port` | Web UI 端口 | `3000` |
| `channels[].weight` | 优先级权重（越高越优先） | `10` |
| `channels[].fallback` | 标记为备用通道 | `false` |
| `channels[].keyStrategy` | Key 轮换策略 | `round-robin` |
| `settings.hotReload` | 配置热重载 | `true` |
| `settings.retry.maxRetries` | 最大重试次数 | `3` |
| `settings.retry.backoff` | 退避策略 | `exponential` |

## 路由策略

| 策略 | 说明 |
|------|------|
| `priority` | 按权重排序，高优先。故障时自动降级 |
| `round-robin` | 轮询均衡分配 |
| `lowest-latency` | 选最近延迟最低的通道 |

## 故障转移

```
请求 → Channel A (weight: 10)
         ↓ 失败？(5xx / 超时)
       Channel B (weight: 5, fallback)
         ↓ 也失败？
       返回错误 + 日志告警
```

- **429 限流** → 换 Key 重试
- **401/403 认证失败** → 标记 Key 失效，换 Key
- **502/503/504 服务错误** → 换通道重试
- 指数退避，避免雪崩

## Web UI

暗色主题的简洁切换面板：

- 🟢🔴 通道状态实时显示
- 延迟 / 成功率 / 调用量统计
- 一键暂停/启用通道
- 实时请求日志滚动
- SSE 推送，无需手动刷新

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 全局状态 |
| `/api/channels` | GET | 通道列表 + 状态 |
| `/api/channels/:name/toggle` | POST | 启用/禁用通道 |
| `/api/channels/:name/keys` | POST | 添加 Key |
| `/api/channels/:name/keys/:i` | DELETE | 删除 Key |
| `/api/logs` | GET | SSE 实时日志流 |
| `/api/logs/recent` | GET | 最近 50 条日志 |
| `/api/stats` | GET | 统计数据 |
| `/api/config/reload` | POST | 手动重载配置 |

## v1 兼容

v1 的 `sites` 配置格式仍然支持，启动时自动转换为 v2 `channels` 格式。

## 技术栈

- **Runtime:** Node.js >= 18 (ESM)
- **SSH:** ssh2（纯 JS，无系统依赖）
- **配置:** js-yaml
- **HTTP:** Node.js 原生 http/https
- **UI:** htmx + Tailwind CDN（零构建）

## 开发

```bash
# 克隆仓库
git clone https://github.com/tomshen124/ai-tunnel.git
cd ai-tunnel
npm install

# 开发模式（文件变动自动重启）
npm run dev

# 运行测试（需要真实 API）
npm test

# 运行 CI 测试（使用 mock API）
npm run test:ci
```

## FAQ

### Q: 需要在 VPS 上安装吗？

不需要。AI-Tunnel 运行在**本地电脑**（有住宅 IP 的环境）。VPS 上的应用通过 SSH 隧道访问本地的 AI-Tunnel。

### Q: 不需要 SSH 隧道可以用吗？

可以！如果你的服务器可以直接访问 API（不被 CF 拦截），可以不配置 SSH。AI-Tunnel 仍然提供多通道路由、Key 轮换、故障转移等功能。把 `tunnel.enabled` 设为 `false` 或不配 `ssh` 段即可。

### Q: 支持哪些 API？

所有 OpenAI 兼容的 API 端点（`/v1/chat/completions`, `/v1/models` 等）。包括但不限于 OpenAI、Anthropic（兼容层）、各种国内中转站等。

### Q: 如何添加/删除 API Key？

三种方式：
1. 编辑 `tunnel.config.yaml`，如开启了 `hotReload` 则自动生效
2. 通过 Web UI 界面操作
3. 通过 REST API：`POST /api/channels/:name/keys`

### Q: 多个 Key 是怎么轮换的？

支持两种策略：
- `round-robin`：按顺序轮流使用
- `random`：随机选择

遇到 429（限流）自动换下一个 Key，401/403 自动标记失效。

### Q: 配置改了需要重启吗？

不需要。默认开启 `hotReload`，修改配置文件后自动重载。也可以通过 Web UI 或 API 手动触发重载。

## License

[MIT](LICENSE)
