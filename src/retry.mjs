// src/retry.mjs - Retry logic with exponential backoff and channel failover

import { log } from "./logger.mjs";

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  retryOn: [429, 502, 503, 504],
  backoff: "exponential",
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

// Status codes that indicate key-level auth failure
const KEY_FAILURE_CODES = [401, 403];

// Status codes that indicate server/infrastructure failure (switch channel)
const CHANNEL_FAILURE_CODES = [502, 503, 504];

/**
 * Create a retry controller from config.
 */
export function createRetryController(config) {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };

  return {
    config: cfg,

    /**
     * Determine if a response status code should trigger a retry.
     */
    shouldRetry(statusCode) {
      return cfg.retryOn.includes(statusCode);
    },

    /**
     * Check if the failure is a key-level issue (401/403).
     */
    isKeyFailure(statusCode) {
      return KEY_FAILURE_CODES.includes(statusCode);
    },

    /**
     * Check if the failure is a channel-level issue (502/503/504).
     */
    isChannelFailure(statusCode) {
      return CHANNEL_FAILURE_CODES.includes(statusCode);
    },

    /**
     * Calculate the delay before the next retry attempt.
     */
    getDelay(attempt) {
      if (cfg.backoff === "exponential") {
        const delay = cfg.baseDelayMs * Math.pow(2, attempt);
        // Add jitter (±25%)
        const jitter = delay * 0.25 * (Math.random() * 2 - 1);
        return Math.min(delay + jitter, cfg.maxDelayMs);
      }
      // fixed
      return cfg.baseDelayMs;
    },

    /**
     * Get max number of retries.
     */
    get maxRetries() {
      return cfg.maxRetries;
    },
  };
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
