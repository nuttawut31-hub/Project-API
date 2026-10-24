const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const request = require("supertest");
require("dotenv").config({ quiet: true });

// ใช้ฐานข้อมูลชั่วคราวชื่อเฉพาะ; ตรวจ migration กับ flow HTTP แล้วลบทิ้งใน finally
async function main() {
  if (process.argv.includes("--child")) return runFlow();
  const name = `gym_phase3_check_${Date.now()}`;
  const admin = await mysql.createConnection({ host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "" });
  let legacy;
  try {
    await admin.query(`CREATE DATABASE \`${name}\``);
    // สร้างฐานข้อมูลในสภาพก่อน migration 003 พร้อมแถวเดิม เพื่อยืนยันว่าการเพิ่มพิกัดไม่ทำให้ข้อมูลหาย
    legacy = await mysql.createConnection({ host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "", database: name });
    await legacy.query("CREATE TABLE schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    for (const file of ["001_initial.sql", "002_auth.sql"]) {
      const source = fs.readFileSync(path.join(__dirname, "..", "migrations", file), "utf8");
      for (const statement of source.split(";").map((item) => item.trim()).filter(Boolean)) await legacy.query(statement);
      await legacy.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
    }
    await legacy.query("INSERT INTO gyms (name, address, monthly_fee, phone_number) VALUES (?, ?, ?, ?)", ["Existing Gym", "Existing address", 900, "000"]);
    await legacy.end();
    legacy = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const env = { ...process.env, DB_NAME: name };
      const result = spawnSync(process.execPath, ["migrate.js"], { cwd: require("node:path").join(__dirname, ".."), env, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      console.log(`Migration run ${attempt}: ${result.stdout.trim()}`);
    }
    legacy = await mysql.createConnection({ host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "", database: name });
    const [preserved] = await legacy.query("SELECT name, latitude, longitude FROM gyms WHERE name = ?", ["Existing Gym"]);
    if (preserved.length !== 1 || preserved[0].latitude !== null || preserved[0].longitude !== null) throw new Error("Migration did not preserve the existing gym row with empty coordinates");
    await legacy.end();
    legacy = null;
    const result = spawnSync(process.execPath, [__filename, "--child"], { env: { ...process.env, DB_NAME: name }, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    console.log(result.stdout.trim());
  } finally {
    if (legacy) await legacy.end();
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
    const [gym] = await pool.query("INSERT INTO gyms (name, address, monthly_fee, phone_number) VALUES (?, ?, ?, ?)", ["Test Gym", "Test address", 1000, "000"]);
    const login = await request(app).post("/api/auth/login").send({ email: "check@example.test", password: "integration-password-123" });
    if (login.status !== 200) throw new Error(`Login: ${login.status}`);
    const header = `Bearer ${login.body.token}`;
    const gymCoordinates = await request(app).put(`/api/gyms/${gym.insertId}`).set("Authorization", header).send({ name: "Test Gym", address: "Test address", monthly_fee: 1000, phone_number: "000", latitude: 13.7, longitude: 100.6 });
    if (gymCoordinates.status !== 200 || gymCoordinates.body.data.latitude !== 13.7 || gymCoordinates.body.data.longitude !== 100.6) throw new Error(`Gym coordinates: ${gymCoordinates.status}`);
    const member = await request(app).post("/api/members").set("Authorization", header).send({ full_name: "Integration Member", email: "member@example.test", phone_number: "0812345678", join_date: "2026-10-23" });
    if (member.status !== 201) throw new Error(`Member: ${member.status}`);
    const membership = await request(app).post("/api/memberships").set("Authorization", header).send({ member_id: member.body.data.id, gym_id: gym.insertId, start_date: "2026-10-23", end_date: "2026-12-23" });
    if (membership.status !== 201) throw new Error(`Membership: ${membership.status}`);
    const updated = await request(app).put(`/api/memberships/${membership.body.data.id}/status`).set("Authorization", header).send({ status: "EXPIRED" });
    if (updated.status !== 200 || updated.body.data.status !== "EXPIRED") throw new Error(`Status: ${updated.status}`);
    const list = await request(app).get("/api/memberships");
    if (list.status !== 200 || list.body.data.length !== 1) throw new Error(`List: ${list.status}`);
    console.log("PASS MySQL flow: migration preserved old gym -> login -> branch coordinates -> member -> membership -> EXPIRED -> list");
  } finally { await pool.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
