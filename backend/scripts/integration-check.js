const { spawnSync } = require("node:child_process");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const request = require("supertest");
require("dotenv").config({ quiet: true });

// ใช้ฐานข้อมูลชั่วคราวชื่อเฉพาะ; ตรวจ migration กับ flow HTTP แล้วลบทิ้งใน finally
async function main() {
  if (process.argv.includes("--child")) return runFlow();
  const name = `gym_phase3_check_${Date.now()}`;
  const admin = await mysql.createConnection({ host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "" });
  try {
    await admin.query(`CREATE DATABASE \`${name}\``);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const env = { ...process.env, DB_NAME: name };
      const result = spawnSync(process.execPath, ["migrate.js"], { cwd: require("node:path").join(__dirname, ".."), env, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      console.log(`Migration run ${attempt}: ${result.stdout.trim()}`);
    }
    const result = spawnSync(process.execPath, [__filename, "--child"], { env: { ...process.env, DB_NAME: name }, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    console.log(result.stdout.trim());
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.end();
  }
}

async function runFlow() {
  const pool = require("../db");
  const app = require("../src/index");
  try {
    const hash = await bcrypt.hash("integration-password-123", 4);
    await pool.query("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)", ["check@example.test", hash, "staff"]);
    await pool.query("INSERT INTO gyms (name, address, monthly_fee, phone_number) VALUES (?, ?, ?, ?)", ["Test Gym", "Test address", 1000, "000"]);
    const login = await request(app).post("/api/auth/login").send({ email: "check@example.test", password: "integration-password-123" });
    if (login.status !== 200) throw new Error(`Login: ${login.status}`);
    const header = `Bearer ${login.body.token}`;
    const member = await request(app).post("/api/members").set("Authorization", header).send({ full_name: "Integration Member", email: "member@example.test", phone_number: "0812345678", join_date: "2026-10-23" });
    if (member.status !== 201) throw new Error(`Member: ${member.status}`);
    const membership = await request(app).post("/api/memberships").set("Authorization", header).send({ member_id: member.body.data.id, gym_id: 1, start_date: "2026-10-23", end_date: "2026-12-23" });
    if (membership.status !== 201) throw new Error(`Membership: ${membership.status}`);
    const updated = await request(app).put(`/api/memberships/${membership.body.data.id}/status`).set("Authorization", header).send({ status: "EXPIRED" });
    if (updated.status !== 200 || updated.body.data.status !== "EXPIRED") throw new Error(`Status: ${updated.status}`);
    const list = await request(app).get("/api/memberships");
    if (list.status !== 200 || list.body.data.length !== 1) throw new Error(`List: ${list.status}`);
    console.log("PASS MySQL flow: login -> member -> membership -> EXPIRED -> list");
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
