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
