const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db");

// สร้างบัญชีสาธิตพร้อมรหัสสุ่มและบันทึกไว้เฉพาะไฟล์ local ที่ถูก gitignore
async function main() {
  const lines = ["Demo accounts for this machine only. Keep this file out of the submission ZIP."];
  for (const role of ["staff", "admin"]) {
    const email = `${role}@fitlife.local`;
    const password = crypto.randomBytes(18).toString("base64url");
    const hash = await bcrypt.hash(password, 12);
    await pool.query("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role)", [email, hash, role]);
    lines.push(`${role}: ${email} / ${password}`);
  }
  const file = path.join(__dirname, "..", ".demo-credentials");
  fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  console.log("Created staff/admin demo accounts; credentials saved to backend/.demo-credentials");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
