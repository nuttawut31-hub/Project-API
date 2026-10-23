const bcrypt = require("bcryptjs");
const pool = require("../db");

// รับข้อมูลจาก environment เพื่อไม่ให้รหัสผ่านปรากฏใน shell history หรือโค้ด
async function main() {
  const { GYM_USER_EMAIL: email, GYM_USER_PASSWORD: password, GYM_USER_ROLE: role } = process.env;
  if (!email || !password || !["staff", "admin"].includes(role) || password.length < 12) {
    throw new Error("Set GYM_USER_EMAIL, GYM_USER_PASSWORD (12+ chars), and GYM_USER_ROLE=staff|admin");
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role)",
    [email, hash, role],
  );
  console.log(`Saved ${role} account: ${email}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => pool.end());
