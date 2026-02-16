# AI-Tunnel

跨平台 API 隧道代理工具 —— 通过本地网络中转，绕过 Cloudflare 等 CDN 对云服务器 IP 的拦截。

## 问题背景

很多第三方 AI 模型中转站（OpenAI 兼容 API）启用了 Cloudflare Bot Management，会对来自 IDC（云服务器）IP 段的请求进行拦截。这意味着：

- ✅ 本地电脑/家庭网络 → API 站点 **正常**
- ❌ 云服务器 (VPS) → API 站点 **被 CF 403 拦截**

当你在云服务器上运行 AI 应用（如 OpenClaw、LobeChat 等）时，就无法直接调用这些 API。

## 解决方案

AI-Tunnel 在**本地电脑**上运行一个轻量代理服务，通过 **SSH 反向隧道**将请求转发到目标 API，绕过 CF 拦截。

```
云端应用 → localhost:端口 → SSH隧道 → 本地代理 → 目标API站点
                VPS                    你的电脑      (不被CF拦截)
```

## 核心功能

### P0 - MVP（最小可用版本）

- [ ] **多站点反代**：支持配置多个 API 站点，每个站点独立端口
- [ ] **SSH 反向隧道**：自动建立 SSH 连接，将本地端口映射到远程 VPS
- [ ] **自动重连**：隧道断开后自动重连，保证服务稳定
- [ ] **配置文件**：YAML/JSON 配置，声明式管理站点和隧道
- [ ] **跨平台**：支持 macOS / Windows / Linux
- [ ] **一键启动**：`node tunnel.mjs` 或 `npx ai-tunnel` 启动所有服务

### P1 - 增强功能

- [ ] **健康检查**：定期检测隧道和目标站点是否可用
- [ ] **状态面板**：终端 UI 或简单 Web UI 显示各隧道状态
- [ ] **日志记录**：请求日志、错误日志、流量统计
- [ ] **多 VPS 支持**：同时连接多台远程服务器
- [ ] **热重载**：修改配置无需重启

### P2 - 高级特性

- [ ] **系统服务**：支持注册为 macOS launchd / Windows Service / Linux systemd
- [ ] **开机自启**：系统启动自动运行
- [ ] **Electron GUI**：桌面托盘应用，图形化管理
- [ ] **API 密钥管理**：本地加密存储 API Key
- [ ] **流量监控**：Prometheus metrics 或内置 dashboard

## 技术方案

### 架构

```
┌─────────────────────────────────────────┐
│              本地电脑                      │
│                                          │
│  ┌──────────┐     ┌──────────────────┐  │
│  │ SSH 隧道  │────→│ 反代服务          │  │
│  │ 管理器    │     │                  │  │
│  │          │     │ :8080 → api-a.com │  │
│  │ 自动重连  │     │ :8081 → api-b.com │  │
│  │ 心跳检测  │     │ :8082 → api-c.com │  │
│  └──────────┘     └──────────────────┘  │
│       │                    │             │
└───────│────────────────────│─────────────┘
        │ SSH反向隧道         │ HTTPS请求
        ▼                    ▼
   ┌─────────┐        ┌──────────┐
   │ 远程VPS  │        │ 目标API   │
   │         │        │ (被CF保护) │
   │ :9090   │        └──────────┘
   │ :9091   │
   │ :9092   │
   └─────────┘
        ▲
        │ http://localhost:909x
   ┌─────────┐
   │ 云端应用  │
   │ OpenClaw │
   └─────────┘
```

### 技术栈

- **Runtime**: Node.js >= 18（原生支持 ESM、fetch）
- **SSH**: 使用 `ssh2` npm 包（纯 JS 实现，无需系统 SSH）
- **HTTP 代理**: Node.js 原生 `http` + `https` 模块
- **配置**: YAML（`js-yaml`）
- **零系统依赖**：不依赖本地 SSH 客户端、nginx 等

### 配置文件示例

```yaml
# tunnel.config.yaml

# SSH 连接配置
ssh:
  host: "150.109.196.158"       # VPS 公网 IP
  port: 22
  username: "root"
  # 认证方式（二选一）
  privateKeyPath: "~/.ssh/id_rsa"  # SSH 私钥路径
  # password: "xxx"                # 或密码认证

# API 站点配置
sites:
  - name: "hotaruapi"
    target: "https://hotaruapi.com"
    localPort: 8080              # 本地反代监听端口
    remotePort: 9090             # VPS 上映射的端口
    healthCheck: "/v1/models"    # 健康检查路径
    headers:                     # 可选：附加请求头
      Authorization: "Bearer sk-xxx"

  - name: "another-api"
    target: "https://another-api.com"
    localPort: 8081
    remotePort: 9091

# 全局设置
settings:
  reconnectInterval: 5000        # 断线重连间隔（ms）
  healthCheckInterval: 60000     # 健康检查间隔（ms）
  logLevel: "info"               # debug | info | warn | error
```

### 使用方式

```bash
# 安装
npm install -g ai-tunnel
# 或者
npx ai-tunnel

# 初始化配置
ai-tunnel init

# 启动
ai-tunnel start

# 查看状态
ai-tunnel status

# 停止
ai-tunnel stop
```

## 实测验证

以下场景已手动验证通过：

| 场景 | 结果 |
|------|------|
| VPS 直连 hotaruapi.com | ❌ CF 403 拦截 |
| VPS 直连 wzw.pp.ua | ✅ 正常（claude-code 分组） |
| 本地 Mac → hotaruapi.com | ✅ 正常 |
| SSH 反向隧道 + Node 反代 → hotaruapi.com | ✅ 正常 |

## 目标用户

- 在云服务器上运行 AI 应用的开发者
- 使用多个第三方 AI API 中转站的用户
- 需要稳定 API 访问但受 CF 拦截困扰的场景

## License

MIT
