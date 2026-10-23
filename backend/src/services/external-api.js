// services/external-api.js
const axios = require("axios");

/**
 * isRetryable — ตรวจสอบว่า error นี้ควร retry หรือไม่
 * - ไม่มี response (network error, timeout) → retry
 * - 429 Too Many Requests → retry
 * - 5xx Server Error → retry
 * - 4xx (ยกเว้น 429) → ไม่ retry (client error)
 */
function isRetryable(error) {
  if (!error.response) return true; // network error / timeout
  const status = error.response.status;
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * delay — sleep utility
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetchWithRetry — เรียก GET ไปยัง URL พร้อม Retry + Timeout + Exponential Backoff + Equal Jitter
 *
 * @param {string} url          - URL ที่จะเรียก
 * @param {number} timeoutMs    - timeout ต่อ attempt (ms), default 3000
 * @param {number} maxRetries   - จำนวน retry สูงสุด (ไม่รวม attempt แรก), default 2
 * @returns {Promise<any>}      - response.data เมื่อสำเร็จ, throw error เมื่อล้มเหลวทุก retry
 */
async function fetchWithRetry(url, timeoutMs = 3000, maxRetries = 2) {
  let attempt = 0;

  while (true) {
    try {
      const response = await axios.get(url, { timeout: timeoutMs });
      return response.data;
    } catch (error) {
      attempt += 1;
      const canRetry = attempt <= maxRetries && isRetryable(error);

      if (!canRetry) {
        throw error;
      }

      const baseBackoffMs = 2 ** (attempt - 1) * 1000;
      const backoffMs = baseBackoffMs / 2 + Math.random() * (baseBackoffMs / 2);

      console.warn(
        `[external-api] request to ${url} failed (attempt ${attempt}/${maxRetries}): ` +
          `${error.message}. Retrying in ${Math.round(backoffMs)}ms`,
      );
      await delay(backoffMs);
    }
  }
}

module.exports = { fetchWithRetry, isRetryable };
