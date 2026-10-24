// services/weather-service.js
// Business logic ดึงข้อมูลสภาพอากาศจาก Open-Meteo API
//  Fallback เมื่อ external API ล้มเหลว

const { fetchWithRetry } = require("./external-api");

/**
 * getWeatherData — ดึงข้อมูลสภาพอากาศจาก Open-Meteo API
 * พร้อม Fallback เมื่อ retry ครบแล้วยังล้มเหลว
 *
 * @param {number} latitude   - ละติจูด (default = กรุงเทพฯ 13.7563)
 * @param {number} longitude  - ลองจิจูด (default = กรุงเทพฯ 100.5018)
 * @returns {Promise<object>} - { source, available, temperature, weathercode, note }
 */
async function getWeatherData(latitude = 13.7563, longitude = 100.5018, options = {}) {
  const url =
    options.url ||
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}&current_weather=true&forecast_days=1&timezone=auto`;
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxRetries = options.maxRetries ?? 2;

  try {
    const data = await fetchWithRetry(url, timeoutMs, maxRetries);

    return {
      source: "external",
      available: true,
      temperature: data.current_weather?.temperature ?? null,
      windspeed: data.current_weather?.windspeed ?? null,
      weathercode: data.current_weather?.weathercode ?? null,
      time: data.current_weather?.time ?? null,
      note: null,
    };
  } catch (error) {
    console.error(
      `[weather-service] external API unavailable after retries: ${error.message}`,
    );

    // Fallback — คืนค่า default แทนการปล่อยให้ระบบ crash
    return {
      source: "fallback",
      available: false,
      temperature: null,
      windspeed: null,
      weathercode: null,
      time: null,
      note: "ไม่สามารถดึงข้อมูลสภาพอากาศจากบริการภายนอกได้ในขณะนี้ กรุณาลองใหม่ภายหลัง",
    };
  }
}

module.exports = { getWeatherData };
