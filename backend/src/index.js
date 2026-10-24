const express = require("express");
const path = require("path");
const YAML = require("js-yaml");
const fs = require("fs");
const swaggerUi = require("swagger-ui-express");

const pool = require("../db");
const { getWeatherData } = require("./services/weather-service");
const { login, requireAuth, requireAdmin } = require("./auth");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());
// backend/ กับ frontend/ เป็นโฟลเดอร์พี่น้องกัน; ให้หน้า Demo อยู่ origin เดียวกับ API
app.use("/app", express.static(path.join(__dirname, "..", "..", "frontend")));
app.get("/app", (req, res) => res.redirect("/app/"));

// ─────────────────────────────────────────────
//  Swagger UI  (/api-docs)
// ─────────────────────────────────────────────
const openapiPath = path.join(__dirname, "..", "openapi.yaml");
const openapiDocument = YAML.load(fs.readFileSync(openapiPath, "utf8"));

// พิกัดเป็นข้อมูลเสริมเพื่อรองรับข้อมูลสาขาเดิมที่ยังไม่เคยระบุตำแหน่ง
function validateGymCoordinates(body) {
  const hasLatitude = Object.hasOwn(body, "latitude");
  const hasLongitude = Object.hasOwn(body, "longitude");
  if (hasLatitude !== hasLongitude) return "latitude and longitude must be provided together";
  if (!hasLatitude) return null;
  if (body.latitude === null && body.longitude === null) return null;
  if (body.latitude === null || body.longitude === null) return "latitude and longitude must be provided together";
  if (typeof body.latitude !== "number" || !Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90) {
    return "latitude must be a number between -90 and 90";
  }
  if (typeof body.longitude !== "number" || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180) {
    return "longitude must be a number between -180 and 180";
  }
  return null;
}

// mysql2 ส่ง DECIMAL เป็น string; API ใช้ number ตาม OpenAPI เพื่อให้หน้าเว็บส่งต่อได้ตรงชนิด
function formatGymCoordinates(gym) {
  return {
    ...gym,
    latitude: gym.latitude == null ? null : Number(gym.latitude),
    longitude: gym.longitude == null ? null : Number(gym.longitude),
  };
}

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(openapiDocument, {
    customSiteTitle: "Gym API Docs",
    swaggerOptions: { docExpansion: "list" },
  }),
);

// ─────────────────────────────────────────────
//  Root
// ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    message: "Gym Membership Management API v2",
    docs: `http://localhost:${PORT}/api-docs`,
  });
});

// เส้นทางอ่านเป็นสาธารณะ; ทุก POST/PUT/DELETE ใต้ /api ต้อง login ก่อน
app.post("/api/auth/login", login);
app.get("/api/auth/me", requireAuth, (req, res) => res.json({ success: true, user: req.user }));
app.use("/api", (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  requireAuth(req, res, () => req.method === "DELETE" ? requireAdmin(req, res, next) : next());
});

// ══════════════════════════════════════════════
//  GYMS
// ══════════════════════════════════════════════

// GET /api/gyms  — ดูทั้งหมด (รองรับ ?max_fee=<number>)
app.get("/api/gyms", async (req, res) => {
  try {
    const { max_fee } = req.query;
    let sql = "SELECT * FROM gyms";
    const params = [];

    if (max_fee !== undefined) {
      const fee = parseFloat(max_fee);
      if (!Number.isFinite(fee) || fee < 0) {
        return res
          .status(400)
          .json({ success: false, message: "max_fee must be a non-negative number" });
      }
      sql += " WHERE monthly_fee <= ?";
      params.push(fee);
    }

    sql += " ORDER BY id ASC";
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, count: rows.length, data: rows.map(formatGymCoordinates) });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// POST /api/gyms  — เพิ่มสาขาใหม่
app.post("/api/gyms", async (req, res) => {
  try {
    const { name, address, monthly_fee, phone_number, latitude = null, longitude = null } = req.body;
    if (!name || !address || monthly_fee == null || !phone_number) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: name, address, monthly_fee, phone_number",
      });
    }
    // DECIMAL ใน MySQL รับเฉพาะค่าตัวเลขที่ไม่ติดลบ; ปฏิเสธก่อนส่ง SQL
    if (typeof monthly_fee !== "number" || !Number.isFinite(monthly_fee) || monthly_fee < 0)
      return res.status(400).json({ success: false, message: "monthly_fee must be a non-negative number" });
    const coordinateError = validateGymCoordinates(req.body);
    if (coordinateError) return res.status(400).json({ success: false, message: coordinateError });
    const [result] = await pool.query(
      "INSERT INTO gyms (name, address, monthly_fee, phone_number, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)",
      [name, address, monthly_fee, phone_number, latitude, longitude],
    );
    const [rows] = await pool.query("SELECT * FROM gyms WHERE id = ?", [
      result.insertId,
    ]);
    res.status(201).json({
      success: true,
      message: "Gym created successfully",
      data: formatGymCoordinates(rows[0]),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// GET /api/gyms/:id  — ดูสาขาตาม ID
app.get("/api/gyms/:id", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM gyms WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: "Gym not found" });
    res.json({ success: true, data: formatGymCoordinates(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// PUT /api/gyms/:id  — แก้ไขสาขา
app.put("/api/gyms/:id", async (req, res) => {
  try {
    const { name, address, monthly_fee, phone_number } = req.body;
    if (!name || !address || monthly_fee == null || !phone_number) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: name, address, monthly_fee, phone_number",
      });
    }
    if (typeof monthly_fee !== "number" || !Number.isFinite(monthly_fee) || monthly_fee < 0)
      return res.status(400).json({ success: false, message: "monthly_fee must be a non-negative number" });
    const coordinateError = validateGymCoordinates(req.body);
    if (coordinateError) return res.status(400).json({ success: false, message: coordinateError });
    const [check] = await pool.query("SELECT id FROM gyms WHERE id = ?", [
      req.params.id,
    ]);
    if (check.length === 0)
      return res.status(404).json({ success: false, message: "Gym not found" });

    // PUT รุ่นเดิมที่ยังไม่ส่งพิกัดต้องไม่ลบพิกัดที่สาขามีอยู่แล้ว
    const updateCoordinates = Object.hasOwn(req.body, "latitude") && Object.hasOwn(req.body, "longitude");
    if (updateCoordinates) {
      await pool.query(
        "UPDATE gyms SET name=?, address=?, monthly_fee=?, phone_number=?, latitude=?, longitude=? WHERE id=?",
        [name, address, monthly_fee, phone_number, req.body.latitude, req.body.longitude, req.params.id],
      );
    } else {
      await pool.query(
        "UPDATE gyms SET name=?, address=?, monthly_fee=?, phone_number=? WHERE id=?",
        [name, address, monthly_fee, phone_number, req.params.id],
      );
    }
    const [rows] = await pool.query("SELECT * FROM gyms WHERE id = ?", [
      req.params.id,
    ]);
    res.json({
      success: true,
      message: "Gym updated successfully",
      data: formatGymCoordinates(rows[0]),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// DELETE /api/gyms/:id  — ลบสาขา
app.delete("/api/gyms/:id", async (req, res) => {
  try {
    const [check] = await pool.query("SELECT id FROM gyms WHERE id = ?", [
      req.params.id,
    ]);
    if (check.length === 0)
      return res.status(404).json({ success: false, message: "Gym not found" });
    await pool.query("DELETE FROM gyms WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: "Gym deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// GET /api/gyms/:gymId/memberships  — ดูประวัติสมาชิกของสาขา
app.get("/api/gyms/:gymId/memberships", async (req, res) => {
  try {
    const [gym] = await pool.query("SELECT * FROM gyms WHERE id = ?", [
      req.params.gymId,
    ]);
    if (gym.length === 0)
      return res.status(404).json({ success: false, message: "Gym not found" });

    const [rows] = await pool.query(
      `SELECT ms.*, m.full_name AS member_name, m.email AS member_email, g.name AS gym_name
       FROM memberships ms
       JOIN members m ON ms.member_id = m.id
       JOIN gyms    g ON ms.gym_id    = g.id
       WHERE ms.gym_id = ?
       ORDER BY ms.id ASC`,
      [req.params.gymId],
    );
    res.json({
      success: true,
      gym_name: gym[0].name,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// ══════════════════════════════════════════════
//  MEMBERS
// ══════════════════════════════════════════════

// GET /api/members
app.get("/api/members", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM members ORDER BY id ASC");
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// POST /api/members
app.post("/api/members", async (req, res) => {
  try {
    const { full_name, email, phone_number, join_date } = req.body;
    if (!full_name || !email || !phone_number || !join_date) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: full_name, email, phone_number, join_date",
      });
    }
    const [dup] = await pool.query("SELECT id FROM members WHERE email = ?", [
      email,
    ]);
    if (dup.length > 0)
      return res
        .status(409)
        .json({ success: false, message: "Email already exists" });

    const [result] = await pool.query(
      "INSERT INTO members (full_name, email, phone_number, join_date) VALUES (?, ?, ?, ?)",
      [full_name, email, phone_number, join_date],
    );
    const [rows] = await pool.query("SELECT * FROM members WHERE id = ?", [
      result.insertId,
    ]);
    res.status(201).json({
      success: true,
      message: "Member created successfully",
      data: rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// GET /api/members/:id
app.get("/api/members/:id", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM members WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// PUT /api/members/:id
app.put("/api/members/:id", async (req, res) => {
  try {
    const { full_name, email, phone_number, join_date } = req.body;
    if (!full_name || !email || !phone_number || !join_date) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: full_name, email, phone_number, join_date",
      });
    }
    const [check] = await pool.query("SELECT id FROM members WHERE id = ?", [
      req.params.id,
    ]);
    if (check.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });

    await pool.query(
      "UPDATE members SET full_name=?, email=?, phone_number=?, join_date=? WHERE id=?",
      [full_name, email, phone_number, join_date, req.params.id],
    );
    const [rows] = await pool.query("SELECT * FROM members WHERE id = ?", [
      req.params.id,
    ]);
    res.json({
      success: true,
      message: "Member updated successfully",
      data: rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// DELETE /api/members/:id
app.delete("/api/members/:id", async (req, res) => {
  try {
    const [check] = await pool.query("SELECT id FROM members WHERE id = ?", [
      req.params.id,
    ]);
    if (check.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });
    await pool.query("DELETE FROM members WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: "Member deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// ══════════════════════════════════════════════
//  MEMBERSHIPS
// ══════════════════════════════════════════════

// GET /api/memberships
app.get("/api/memberships", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ms.*, m.full_name AS member_name, m.email AS member_email, g.name AS gym_name
       FROM memberships ms
       JOIN members m ON ms.member_id = m.id
       JOIN gyms    g ON ms.gym_id    = g.id
       ORDER BY ms.id ASC`,
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// POST /api/memberships
app.post("/api/memberships", async (req, res) => {
  try {
    const {
      member_id,
      gym_id,
      start_date,
      end_date,
      status = "ACTIVE",
    } = req.body;
    if (!member_id || !gym_id || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: member_id, gym_id, start_date, end_date",
      });
    }
    // ช่วงวันที่ต้องเรียงถูกต้องและ status ต้องเป็นข้อความตาม enum
    if (typeof start_date !== "string" || typeof end_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date) || end_date < start_date)
      return res.status(400).json({ success: false, message: "Invalid date range" });
    const [memberCheck] = await pool.query(
      "SELECT id FROM members WHERE id = ?",
      [member_id],
    );
    if (memberCheck.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });

    const [gymCheck] = await pool.query("SELECT id FROM gyms WHERE id = ?", [
      gym_id,
    ]);
    if (gymCheck.length === 0)
      return res.status(404).json({ success: false, message: "Gym not found" });

    const validStatuses = ["ACTIVE", "EXPIRED", "CANCELLED"];
    if (typeof status !== "string" || !validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be ACTIVE, EXPIRED, or CANCELLED",
      });
    }

    const [result] = await pool.query(
      "INSERT INTO memberships (member_id, gym_id, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)",
      [member_id, gym_id, start_date, end_date, status.toUpperCase()],
    );
    const [rows] = await pool.query("SELECT * FROM memberships WHERE id = ?", [
      result.insertId,
    ]);
    res.status(201).json({
      success: true,
      message: "Membership created successfully",
      data: rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// PUT /api/memberships/:id/status  — อัปเดตสถานะ
app.put("/api/memberships/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["ACTIVE", "EXPIRED", "CANCELLED"];
    if (!status) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required field: status" });
    }
    if (typeof status !== "string" || !validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be ACTIVE, EXPIRED, or CANCELLED",
      });
    }
    const [check] = await pool.query(
      "SELECT id FROM memberships WHERE id = ?",
      [req.params.id],
    );
    if (check.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Membership not found" });

    await pool.query("UPDATE memberships SET status=? WHERE id=?", [
      status.toUpperCase(),
      req.params.id,
    ]);
    const [rows] = await pool.query("SELECT * FROM memberships WHERE id = ?", [
      req.params.id,
    ]);
    res.json({
      success: true,
      message: "Membership status updated successfully",
      data: rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// ══════════════════════════════════════════════
//  WEATHER  (External API — Open-Meteo)
// ══════════════════════════════════════════════
app.get("/api/weather", async (req, res) => {
  try {
    if ((req.query.lat === undefined) !== (req.query.lon === undefined)) {
      return res.status(400).json({ success: false, message: "lat and lon must be provided together" });
    }
    if (req.query.lat !== undefined && (String(req.query.lat).trim() === "" || String(req.query.lon).trim() === "")) {
      return res.status(400).json({ success: false, message: "lat and lon must be valid numbers" });
    }
    const lat = req.query.lat === undefined ? 13.7563 : Number(req.query.lat);
    const lon = req.query.lon === undefined ? 100.5018 : Number(req.query.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      return res.status(400).json({ success: false, message: "lat must be between -90 and 90 and lon between -180 and 180" });
    }

    // weather-service จัดการ fallback ไว้แล้ว → route นี้คืน 200 เสมอ
    const weather = await getWeatherData(lat, lon);

    return res.status(200).json({
      data: { weather },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// ─────────────────────────────────────────────
// เปิดพอร์ตเฉพาะเมื่อรันไฟล์โดยตรง; ตอนทดสอบจะ import app ไปเปิดพอร์ตชั่วคราว
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Frontend   at http://localhost:${PORT}/app/`);
    console.log(`API Docs   at http://localhost:${PORT}/api-docs`);
  });
}

module.exports = app;
