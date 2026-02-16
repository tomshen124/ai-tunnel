# AI-Tunnel

跨平台 API 隧道代理 —— 多通道智能路由、自动故障转移、简洁切换面板。

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

## 快速开始

### 安装

```bash
# 全局安装
npm install -g ai-tunnel

# 或者 clone 后运行
git clone https://github.com/tomshen124/ai-tunnel.git
cd ai-tunnel
npm install
```

### 配置

```bash
# 生成配置文件
ai-tunnel init
# 或
cp tunnel.config.example.yaml tunnel.config.yaml

# 编辑配置
vim tunnel.config.yaml
```

### 启动

```bash
# 启动
ai-tunnel start
# 或
npm start
# 或
node src/index.mjs
```

启动后：
- **Proxy 入口：** `http://127.0.0.1:9000`
- **Web UI：** `http://127.0.0.1:3000`

### 在 VPS 应用中使用

将 AI 应用的 API Base URL 改为：

```
http://localhost:9000
```

例如 OpenClaw 配置：
```yaml
providers:
  - baseURL: http://localhost:9000/v1
    apiKey: sk-your-key  # Key 可以在 tunnel 配置里管理
```

## 配置说明

```yaml
# 服务配置
server:
  port: 9000              # 统一代理入口
  host: "127.0.0.1"
  ui:
    enabled: true
    port: 3000            # Web UI 端口

# SSH（可选）
ssh:
  host: "VPS_IP"
  port: 22
  username: "root"
  privateKeyPath: "~/.ssh/id_rsa"

# API 通道
channels:
  - name: "primary"
    target: "https://api-site.com"
    keys: ["sk-key1", "sk-key2"]
    keyStrategy: "round-robin"    # round-robin | random
    weight: 10                    # 优先级权重
    tunnel:                       # SSH 隧道配置（可选）
      enabled: true
      localPort: 8080
      remotePort: 9090
    healthCheck:
      path: "/v1/models"
      intervalMs: 60000

  - name: "backup"
    target: "https://backup-api.com"
    keys: ["sk-backup"]
    weight: 5
    fallback: true                # 标记为备用

# 路由
routes:
  - path: "/v1/**"
    channels: ["primary", "backup"]
    strategy: "priority"          # priority | round-robin | lowest-latency

# 全局
settings:
  hotReload: true
  retry:
    maxRetries: 3
    retryOn: [429, 502, 503, 504]
    backoff: "exponential"
```

## Web UI

暗色主题的简洁切换面板：

- 🟢🔴 通道状态实时显示
- 延迟 / 成功率 / 调用量统计
- 一键暂停/启用通道
- 实时请求日志滚动
- SSE 推送，无需手动刷新

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
       Channel B (weight: 5)
         ↓ 也失败？
       返回错误 + 日志告警
```

- 429 限流 → 换 Key 重试
- 401/403 认证失败 → 标记 Key 失效，换 Key
- 502/503/504 → 换通道重试
- 指数退避，避免雪崩

## v1 兼容

v1 的 `sites` 配置格式仍然支持，启动时自动转换为 v2 `channels` 格式。

## 技术栈

- **Runtime:** Node.js >= 18 (ESM)
- **SSH:** ssh2（纯 JS，无系统依赖）
- **配置:** js-yaml
- **HTTP:** Node.js 原生 http/https
- **UI:** htmx + Tailwind CDN（零构建）

## API

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

## License

MIT
