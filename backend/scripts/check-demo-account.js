const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");
const app = require("../src/index");
const pool = require("../db");

// ตรวจว่าบัญชีที่สร้างในฐานข้อมูลนำเสนอ login ได้ โดยไม่แสดงรหัสผ่านใน output
async function main() {
  const file = path.join(__dirname, "..", ".demo-credentials");
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((value) => value.startsWith("staff:"));
  const match = /^staff: (\S+) \/ (\S+)$/.exec(line || "");
  if (!match) throw new Error("Staff demo credentials missing");
  const login = await request(app).post("/api/auth/login").send({ email: match[1], password: match[2] });
  if (login.status !== 200) throw new Error(`Login failed: HTTP ${login.status}`);
  const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.token}`);
  if (me.status !== 200 || me.body.user.role !== "staff") throw new Error(`Session check failed: HTTP ${me.status}`);
  const gyms = await request(app).get("/api/gyms");
  if (gyms.status !== 200 || gyms.body.data.length === 0) throw new Error("No gym available for demo");
  console.log("PASS demo database: staff login, session, and gym list");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
