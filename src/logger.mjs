// src/logger.mjs - Logger with event bus for UI subscriptions

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = LEVELS.info;

const COLORS = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m",  // cyan
  warn: "\x1b[33m",  // yellow
  error: "\x1b[31m", // red
  reset: "\x1b[0m",
};

const ICONS = {
  debug: "🔍",
  info: "✅",
  warn: "⚠️ ",
  error: "❌",
};

// Event bus: subscribers keyed by event type
const subscribers = new Map();

// Ring buffer for recent log entries (for /api/logs snapshot)
const LOG_BUFFER_SIZE = 200;
const logBuffer = [];

export function setLogLevel(level) {
  currentLevel = LEVELS[level] ?? LEVELS.info;
}

export function getLogLevel() {
  return Object.keys(LEVELS).find((k) => LEVELS[k] === currentLevel) || "info";
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

  // Store in ring buffer
  const entry = {
    time: new Date().toISOString(),
    level,
    tag,
    message: formatted,
  };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();

  // Emit to SSE subscribers
  emit("log", entry);
}

/**
 * Get recent log entries.
 */
export function getRecentLogs(count = 50) {
  return logBuffer.slice(-count);
}

/**
 * Emit an event to all subscribers of that type.
 * Also emits to "*" (wildcard) subscribers.
 */
export function emit(eventType, data) {
  const handlers = subscribers.get(eventType);
  if (handlers) {
    for (const fn of handlers) {
      try {
        fn(eventType, data);
      } catch (_) {
        // ignore subscriber errors
      }
    }
  }

  // Wildcard subscribers
  const wildcardHandlers = subscribers.get("*");
  if (wildcardHandlers) {
    for (const fn of wildcardHandlers) {
      try {
        fn(eventType, data);
      } catch (_) {
        // ignore
      }
    }
  }
}

/**
 * Subscribe to events. Use "*" to subscribe to all events.
 * Returns an unsubscribe function.
 */
export function subscribe(eventType, handler) {
  if (!subscribers.has(eventType)) {
    subscribers.set(eventType, new Set());
  }
  subscribers.get(eventType).add(handler);

  return () => {
    const handlers = subscribers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) subscribers.delete(eventType);
    }
  };
}
