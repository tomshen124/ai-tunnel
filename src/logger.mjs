// src/logger.mjs - 简单日志模块

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = LEVELS.info;

const COLORS = {
  debug: "\x1b[90m",  // gray
  info: "\x1b[36m",   // cyan
  warn: "\x1b[33m",   // yellow
  error: "\x1b[31m",  // red
  reset: "\x1b[0m",
};

const ICONS = {
  debug: "🔍",
  info: "✅",
  warn: "⚠️ ",
  error: "❌",
};

export function setLogLevel(level) {
  currentLevel = LEVELS[level] ?? LEVELS.info;
}

export function log(level, tag, msg, ...args) {
  if ((LEVELS[level] ?? 0) < currentLevel) return;

  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  const color = COLORS[level] || "";
  const icon = ICONS[level] || "";
  const prefix = `${color}${time} ${icon} [${tag}]${COLORS.reset}`;

  // Simple format string replacement
  let formatted = msg;
  for (const arg of args) {
    formatted = formatted.replace(/%[sd]/, String(arg));
  }

  console.log(`${prefix} ${formatted}`);
}
