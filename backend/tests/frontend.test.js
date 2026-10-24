const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const frontend = path.join(__dirname, "..", "..", "frontend");
const html = fs.readFileSync(path.join(frontend, "index.html"), "utf8");
const script = fs.readFileSync(path.join(frontend, "app.js"), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function page(fetchImpl) {
  const dom = new JSDOM(html, { url: "http://localhost:3000/app/", runScripts: "outside-only" });
  // jsdom ไม่มี API เลื่อนหน้า; browser จริงมี จึงจำลองเฉพาะส่วนนี้เพื่อทดสอบ flow login
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.fetch = fetchImpl;
  dom.window.eval(script);
  return dom;
}
const json = (data) => ({ ok: true, status: 200, json: async () => data });

test("frontend shows loading, loaded data, and unlocks form after login", async () => {
  const fetchImpl = jest.fn(async (url) => {
    if (url === "/api/auth/login") return json({ token: "sample-token", user: { email: "staff@example.test", role: "staff" } });
    if (url === "/api/gyms") return json({ data: [{ id: 1, name: "FitLife", address: "Bangkok", monthly_fee: "1000.00" }] });
    if (url === "/api/members") return json({ data: [] });
    return json({ data: [] });
  });
  const dom = page(fetchImpl);
  const doc = dom.window.document;
  expect(doc.querySelector("#summary").textContent).toBe("กำลังโหลด...");
  await tick(); await tick();
  expect(doc.querySelector("#summary").textContent).toContain("1 สาขา");
  expect(doc.querySelector("#member-form button").disabled).toBe(true);
  doc.querySelector("#login-form [name=email]").value = "staff@example.test";
  doc.querySelector("#login-form [name=password]").value = "demo-password";
  doc.querySelector("#login-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await tick(); await tick();
  expect(doc.querySelector("#session-user").textContent).toContain("staff");
  expect(doc.querySelector("#member-form button").disabled).toBe(false);
  expect(doc.querySelector("#notice").textContent).toContain("เข้าสู่ระบบสำเร็จ");
  dom.window.close();
});

test("frontend reports API failure and loading error state", async () => {
  const dom = page(jest.fn(async () => { throw new Error("network down"); }));
  await tick(); await tick();
  const doc = dom.window.document;
  expect(doc.querySelector("#summary").textContent).toBe("โหลดข้อมูลไม่ได้");
  expect(doc.querySelector("#notice").textContent).toContain("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  dom.window.close();
});

test("member detail button loads the selected member inline and toggles it closed", async () => {
  const fetchImpl = jest.fn(async (url) => {
    if (url === "/api/members") return json({ data: [{ id: 9, full_name: "Somchai", email: "somchai@example.test" }] });
    if (url === "/api/members/9") return json({ data: { id: 9, full_name: "Somchai", email: "somchai@example.test", phone_number: "0812345678", join_date: "2026-10-23" } });
    return json({ data: [] });
  });
  const dom = page(fetchImpl);
  await tick(); await tick();
  const button = dom.window.document.querySelector("#member-list .record-link");
  const panel = dom.window.document.querySelector("#member-detail-9");
  expect(panel.hidden).toBe(true);
  button.click();
  await tick();
  expect(fetchImpl).toHaveBeenCalledWith("/api/members/9", expect.any(Object));
  expect(panel.hidden).toBe(false);
  expect(panel.textContent).toContain("0812345678");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  button.click();
  expect(panel.hidden).toBe(true);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  dom.window.close();
});

test("gym detail button shows the selected branch inline and can close it", async () => {
  const fetchImpl = jest.fn(async (url) => {
    if (url === "/api/gyms") return json({ data: [{ id: 2, name: "FitLife Test", address: "Bangkok", monthly_fee: "1200", phone_number: "021234567" }] });
    if (url === "/api/gyms/2") return json({ data: { id: 2, name: "FitLife Test", address: "Bangkok", monthly_fee: "1200", phone_number: "021234567" } });
    return json({ data: [] });
  });
  const dom = page(fetchImpl);
  await tick(); await tick();
  const button = dom.window.document.querySelector("#gym-list .record-actions button");
  const panel = dom.window.document.querySelector("#gym-detail-panel");
  expect(panel.hidden).toBe(true);
  button.click();
  await tick();
  expect(fetchImpl).toHaveBeenCalledWith("/api/gyms/2", expect.any(Object));
  expect(panel.textContent).toContain("021234567");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  dom.window.document.querySelector("#gym-detail-close").click();
  expect(panel.hidden).toBe(true);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  dom.window.close();
});

test("weather card loads current weather for the selected branch coordinates", async () => {
  const gym = { id: 3, name: "FitLife Mega Bangna", address: "Bang Na", monthly_fee: "1350", latitude: 13.6, longitude: 100.7 };
  const fetchImpl = jest.fn(async (url) => {
    if (url === "/api/gyms") return json({ data: [gym] });
    if (url.startsWith("/api/weather?")) return json({ data: { weather: {
      available: true, temperature: 29, windspeed: 5, weathercode: 2, time: "2026-10-24T12:00",
    } } });
    return json({ data: [] });
  });
  const dom = page(fetchImpl);
  await tick(); await tick();
  const doc = dom.window.document;
  expect(doc.querySelector("#weather-gym").value).toBe("3");
  doc.querySelector("#weather-reload").click();
  await tick(); await tick();
  expect(fetchImpl).toHaveBeenCalledWith("/api/weather?lat=13.6&lon=100.7", expect.any(Object));
  expect(doc.querySelector("#weather-result").textContent).toContain("มีเมฆบางส่วน");
  expect(doc.querySelector("#weather-result").textContent).toContain("29°C");
  expect(doc.querySelector("#weather-result").textContent).toContain("Open-Meteo");
  dom.window.close();
});

test("weather card explains missing branch coordinates without calling the weather API", async () => {
  const fetchImpl = jest.fn(async (url) => {
    if (url === "/api/gyms") return json({ data: [{ id: 4, name: "FitLife Test", address: "Bangkok", monthly_fee: "1000" }] });
    return json({ data: [] });
  });
  const dom = page(fetchImpl);
  await tick(); await tick();
  const doc = dom.window.document;
  expect(doc.querySelector("#weather-help").textContent).toContain("ยังไม่มีพิกัด");
  doc.querySelector("#weather-reload").click();
  expect(doc.querySelector("#weather-result").textContent).toContain("ไม่มีพิกัด");
  expect(fetchImpl.mock.calls.some(([url]) => String(url).startsWith("/api/weather"))).toBe(false);
  dom.window.close();
});

test("weather card displays the service fallback without breaking the dashboard", async () => {
  const fetchImpl = jest.fn(async (url) => {
    if (url === "/api/gyms") return json({ data: [{ id: 5, name: "FitLife Test", address: "Bangkok", monthly_fee: "1000", latitude: 13.7, longitude: 100.6 }] });
    if (url.startsWith("/api/weather?")) return json({ data: { weather: { available: false, note: "บริการสภาพอากาศไม่พร้อม" } } });
    return json({ data: [] });
  });
  const dom = page(fetchImpl);
  await tick(); await tick();
  dom.window.document.querySelector("#weather-reload").click();
  await tick(); await tick();
  expect(dom.window.document.querySelector("#weather-result").textContent).toContain("บริการสภาพอากาศไม่พร้อม");
  expect(dom.window.document.querySelector("#weather-result").classList.contains("error")).toBe(true);
  dom.window.close();
});
