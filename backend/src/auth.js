const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const pool = require("../db");

// Login ตรวจรหัสผ่านที่ hash ไว้ และออก token อายุสั้นโดยไม่ส่ง hash กลับไป
async function login(req, res) {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }
  if (!process.env.JWT_SECRET) return res.status(500).json({ success: false, message: "JWT_SECRET is not configured" });
  try {
    const [rows] = await pool.query("SELECT id, email, password_hash, role FROM users WHERE email = ?", [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    const token = jwt.sign({ sub: String(user.id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "2h" });
    return res.json({ success: true, token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

// อ่านตัวตนจาก Bearer token แล้วตรวจบัญชีใน DB อีกครั้งเพื่อรองรับการลบบัญชีทันที
async function requireAuth(req, res, next) {
  const match = /^Bearer (\S+)$/i.exec(req.headers.authorization || "");
  if (!match || !process.env.JWT_SECRET) return res.status(401).json({ success: false, message: "Authentication required" });
  try {
    const payload = jwt.verify(match[1], process.env.JWT_SECRET);
    const [rows] = await pool.query("SELECT id, email, role FROM users WHERE id = ?", [payload.sub]);
    if (!rows[0] || rows[0].role !== payload.role) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    req.user = rows[0];
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

// งานลบข้อมูลสงวนให้ admin เพราะกระทบสมาชิกและการสมัครแบบ cascade
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "Admin role required" });
  next();
}

module.exports = { login, requireAuth, requireAdmin };
