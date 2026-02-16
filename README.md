# AI-Tunnel

跨平台 API 隧道代理网关 —— 通过 SSH 反向隧道绕过 Cloudflare 拦截，支持多通道冗余、Key 池轮换、智能路由和 Web UI。

## 问题背景

很多第三方 AI 模型中转站启用了 Cloudflare Bot Management，会拦截来自云服务器 IP 的请求：

- ✅ 本地电脑/家庭网络 → API 站点 正常
- ❌ 云服务器 (VPS) → API 站点 被 CF 403 拦截

## 解决方案

AI-Tunnel 在本地电脑运行，通过 SSH 反向隧道将 VPS 上的 API 请求路由到本地，再由本地转发到目标 API。

```
VPS (应用) → localhost:9000 → SSH 隧道 → 本地反代 → 目标 API
                统一入口         你的电脑      (不被CF拦截)
```

## 核心功能

- **统一入口** — 一个端口 `:9000`，替代多端口，对应用透明
- **多通道冗余** — 多个 API 站点自动故障转移
- **Key 池轮换** — 同一站点多个 Key 轮换使用，避免限流
- **智能路由** — 支持 priority / round-robin / lowest-latency 策略
- **智能重试** — 429 换 Key，5xx 换通道，指数退避
- **健康检查** — 定期检测站点可用性
- **配置热重载** — 修改配置无需重启
- **Web UI** — 简洁切换面板，一眼看状态，一键切通道
- **SSE 流式** — 完美支持 AI API 的流式响应

## 快速开始

### 安装

```bash
git clone https://github.com/tomshen124/ai-tunnel.git
cd ai-tunnel
npm install
```

### 配置

```bash
cp tunnel.config.example.yaml tunnel.config.yaml
# 编辑配置文件，填入你的 VPS 和 API 信息
```

### 启动

```bash
# 在本地电脑上运行
npm start
```

启动后：
- 代理入口: `http://127.0.0.1:9000`
- Web UI: `http://127.0.0.1:3000`

### 在 VPS 上使用

将应用的 API baseURL 改为 `http://localhost:9000`，其他不变。

## 配置示例

```yaml
server:
  port: 9000
  ui:
    enabled: true
    port: 3000

ssh:
  host: "你的VPS_IP"
  port: 22
  username: "root"
  privateKeyPath: "~/.ssh/id_rsa"

channels:
  - name: "hotaru"
    target: "https://hotaruapi.com"
    keys:
      - "sk-key-1"
      - "sk-key-2"
    weight: 10
    tunnel:
      enabled: true
      localPort: 8080
      remotePort: 9090
    healthCheck:
      path: "/v1/models"
      intervalMs: 60000

  - name: "backup"
    target: "https://backup-api.com"
    keys:
      - "sk-backup"
    weight: 5
    fallback: true
    tunnel:
      enabled: true
      localPort: 8081
      remotePort: 9091

settings:
  hotReload: true
  retry:
    maxRetries: 3
    retryOn: [429, 502, 503, 504]
    backoff: "exponential"
```

## 路由策略

| 策略 | 说明 |
|------|------|
| `priority` | 按权重优先，故障自动降级 |
| `round-robin` | 轮询均衡分配 |
| `lowest-latency` | 选延迟最低的通道 |

## Web UI

访问 `http://127.0.0.1:3000` 打开切换面板：

- 📊 各通道状态一览（在线/离线/延迟/成功率）
- 🔄 一键启用/暂停通道
- 📋 实时请求日志
- 🔑 Key 池状态

## API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 全局状态 |
| `/api/channels` | GET | 通道列表 |
| `/api/channels/:name/toggle` | POST | 启用/禁用通道 |
| `/api/channels/:name/keys` | POST | 添加 Key |
| `/api/channels/:name/keys/:idx` | DELETE | 删除 Key |
| `/api/stats` | GET | 统计数据 |
| `/api/logs` | GET | 实时日志 (SSE) |
| `/api/config/reload` | POST | 手动重载配置 |

## 项目结构

```
ai-tunnel/
├── src/
│   ├── index.mjs      # 主入口
│   ├── cli.mjs        # CLI
│   ├── config.mjs     # 配置加载 + v1 兼容 + 热重载
│   ├── router.mjs     # 路由引擎（策略 + 故障转移）
│   ├── channel.mjs    # Channel 管理（Key 池 + 状态）
│   ├── proxy.mjs      # 统一反向代理
│   ├── tunnel.mjs     # SSH 反向隧道
│   ├── retry.mjs      # 重试逻辑
│   ├── health.mjs     # 健康检查
│   ├── api.mjs        # Web API + SSE
│   ├── logger.mjs     # 日志 + 事件总线
│   └── ui/
│       └── index.html  # Web UI
├── docs/
│   └── V2_DESIGN.md   # 设计文档
├── tunnel.config.example.yaml
├── package.json
├── AGENTS.md
└── README.md
```

## 技术栈

- Node.js >= 18 (ESM)
- ssh2（纯 JS SSH）
- js-yaml
- htmx + Tailwind CDN（Web UI，零构建）
- 零框架，最少依赖

## License

MIT
