# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-02-18

### Added

- **Unified proxy entry** — Single port `:9000` replaces v1's per-site multi-port model
- **Multi-channel routing engine** with three strategies: `priority`, `round-robin`, `lowest-latency`
- **API key pool** per channel — round-robin / random rotation, auto-disable on auth failure
- **Automatic failover** — 5xx errors trigger channel switch; 429/401/403 trigger key rotation
- **Exponential backoff retry** with jitter to prevent thundering herd
- **Health checks** — Periodic probing of channels, auto-mark unhealthy after consecutive failures
- **Web UI** — Dark-themed CC-Switch-style panel at `:3000` with real-time SSE updates
- **REST API** — Full management API for status, channels, keys, stats, logs, and config reload
- **Hot reload** — Config file changes are detected and applied without restart
- **v1 config compatibility** — Old `sites` format auto-converts to `channels`
- **CLI commands** — `ai-tunnel init`, `start`, `status`, `stop`, `help`
- **CI test suite** — Mock API-based tests that run without external dependencies

### Changed

- **SSH tunnels** now use `ssh2` pure JS library (was already the case in late v1)
- **Config format** — `channels` replaces `sites`; `routes` replaces implicit per-site routing
- **Logging** — Enhanced with event bus for SSE subscriptions and ring buffer for recent logs

### Removed

- Per-site independent ports (replaced by unified `:9000` entry)
- Direct `headers.Authorization` config (replaced by `keys` array)

## [1.0.0] - 2024-12-01

### Added

- SSH reverse tunnel proxy for API relay
- Multi-site support with per-site ports
- SSE streaming passthrough
- Auto-reconnect on SSH disconnect
- Colorized terminal logging
- Graceful shutdown on SIGINT/SIGTERM
