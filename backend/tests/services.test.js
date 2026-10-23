// ตรวจ retry, timeout policy และ fallback โดย mock เฉพาะ HTTP ภายนอก ไม่เรียกเครือข่ายจริง
jest.mock("axios");
const axios = require("axios");
const { fetchWithRetry, isRetryable } = require("../src/services/external-api");
const { getWeatherData } = require("../src/services/weather-service");

beforeEach(() => { jest.spyOn(console, "warn").mockImplementation(() => {}); jest.spyOn(console, "error").mockImplementation(() => {}); jest.spyOn(Math, "random").mockReturnValue(0); });
afterEach(() => { jest.restoreAllMocks(); axios.get.mockReset(); });

test("retry policy distinguishes network, rate limit, server, and client errors", () => {
  expect(isRetryable({})).toBe(true);
  expect(isRetryable({ response: { status: 429 } })).toBe(true);
  expect(isRetryable({ response: { status: 503 } })).toBe(true);
  expect(isRetryable({ response: { status: 400 } })).toBe(false);
});

test("external request forwards timeout and returns data on first success", async () => {
  axios.get.mockResolvedValue({ data: { current_weather: { temperature: 32 } } });
  await expect(fetchWithRetry("https://example.test/weather", 123, 2)).resolves.toEqual({ current_weather: { temperature: 32 } });
  expect(axios.get).toHaveBeenCalledWith("https://example.test/weather", { timeout: 123 });
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test("429 retries once and returns recovered response", async () => {
  axios.get.mockRejectedValueOnce(Object.assign(new Error("rate limited"), { response: { status: 429 } }))
    .mockResolvedValueOnce({ data: { recovered: true } });
  const result = fetchWithRetry("https://example.test/weather", 3000, 1);
  await expect(result).resolves.toEqual({ recovered: true });
  expect(axios.get).toHaveBeenCalledTimes(2);
});

test("client error stops immediately while repeated server failures stop after limit", async () => {
  const badRequest = Object.assign(new Error("bad request"), { response: { status: 400 } });
  axios.get.mockRejectedValueOnce(badRequest);
  await expect(fetchWithRetry("https://example.test", 100, 2)).rejects.toBe(badRequest);
  expect(axios.get).toHaveBeenCalledTimes(1);
  axios.get.mockReset().mockRejectedValue(Object.assign(new Error("unavailable"), { response: { status: 503 } }));
  const result = fetchWithRetry("https://example.test", 100, 1);
  const rejection = expect(result).rejects.toThrow("unavailable");
  await rejection;
  expect(axios.get).toHaveBeenCalledTimes(2);
});

test("weather service maps external fields and preserves missing fields as null", async () => {
  axios.get.mockResolvedValue({ data: { current_weather: { temperature: 29, windspeed: 5, weathercode: 1, time: "2026-10-23T12:00" } } });
  const weather = await getWeatherData(13, 100, { timeoutMs: 100, maxRetries: 0 });
  expect(weather).toMatchObject({ source: "external", available: true, temperature: 29, windspeed: 5, weathercode: 1 });
  expect(axios.get.mock.calls[0][0]).toContain("latitude=13&longitude=100");
  axios.get.mockResolvedValue({ data: {} });
  expect(await getWeatherData()).toMatchObject({ available: true, temperature: null, weathercode: null });
});

test("weather service returns usable fallback after external failure", async () => {
  axios.get.mockRejectedValue(new Error("offline"));
  const weather = await getWeatherData(13, 100, { maxRetries: 0 });
  expect(weather).toMatchObject({ source: "fallback", available: false, temperature: null });
  expect(weather.note).toContain("ไม่สามารถดึงข้อมูลสภาพอากาศ");
});
