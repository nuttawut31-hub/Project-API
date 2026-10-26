// Express รับ HTTP request และใช้สร้าง API/server ของระบบ
const express = require("express");
const path = require("path");
const YAML = require("js-yaml");
const fs = require("fs");
const swaggerUi = require("swagger-ui-express");

// pool เป็น connection pool ที่ใช้คุยกับ MySQL ร่วมกันทุก route
const pool = require("../db");
// แยกงานเรียก Open-Meteo และงานตรวจ login/สิทธิ์ไว้ใน service และ auth
const { getWeatherData } = require("./services/weather-service");
const { login, requireAuth, requireAdmin } = require("./auth");

// ใช้ PORT จาก environment ถ้าไม่มีให้ใช้ 3000
const PORT = process.env.PORT || 3000;
const app = express();

// แปลง JSON request body ให้ route อ่านข้อมูลได้จาก req.body
app.use(express.json());
// รองรับทั้งโครงสร้างตอนพัฒนา (backend/src + frontend) และชุดส่งงาน (src + frontend)
const packagedFrontendPath = path.join(__dirname, "..", "frontend");
const workspaceFrontendPath = path.join(__dirname, "..", "..", "frontend");
const frontendPath = fs.existsSync(packagedFrontendPath)
  ? packagedFrontendPath
  : workspaceFrontendPath;
app.use("/app", express.static(frontendPath));
// เปลี่ยน /app เป็น /app/ เพื่อให้ path ของไฟล์หน้าเว็บทำงานสม่ำเสมอ
app.get("/app", (req, res) => res.redirect("/app/"));

// ─────────────────────────────────────────────
//  Swagger UI  (/api-docs)
// ─────────────────────────────────────────────
const openapiPath = path.join(__dirname, "..", "openapi.yaml");
// โหลดสัญญา API จาก YAML แล้วนำไปแสดงเป็นหน้า Swagger ที่ /api-docs
const openapiDocument = YAML.load(fs.readFileSync(openapiPath, "utf8"));

// พิกัดเป็นข้อมูลเสริมเพื่อรองรับข้อมูลสาขาเดิมที่ยังไม่เคยระบุตำแหน่ง
function validateGymCoordinates(body) {
  // พิกัดต้องส่งมาครบคู่ หรือไม่ส่งทั้งคู่ก็ได้ เพราะสาขาเก่าอาจยังไม่มีพิกัด
  const hasLatitude = Object.hasOwn(body, "latitude");
  const hasLongitude = Object.hasOwn(body, "longitude");
  if (hasLatitude !== hasLongitude)
    return "latitude and longitude must be provided together";
  if (!hasLatitude) return null;
  if (body.latitude === null && body.longitude === null) return null;
  if (body.latitude === null || body.longitude === null)
    return "latitude and longitude must be provided together";
  if (
    typeof body.latitude !== "number" ||
    !Number.isFinite(body.latitude) ||
    body.latitude < -90 ||
    body.latitude > 90
  ) {
    return "latitude must be a number between -90 and 90";
  }
  if (
    typeof body.longitude !== "number" ||
    !Number.isFinite(body.longitude) ||
    body.longitude < -180 ||
    body.longitude > 180
  ) {
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

// Login เปิดให้เรียกได้โดยยังไม่ต้องมี token; /me ใช้ตรวจ token ปัจจุบัน
app.post("/api/auth/login", login);
app.get("/api/auth/me", requireAuth, (req, res) =>
  res.json({ success: true, user: req.user }),
);
// middleware กลาง: GET อ่านได้สาธารณะ, การเขียนต้อง login และ DELETE ต้องเป็น admin
app.use("/api", (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  requireAuth(req, res, () =>
    req.method === "DELETE" ? requireAdmin(req, res, next) : next(),
  );
});

// ══════════════════════════════════════════════
//  GYMS
// ══════════════════════════════════════════════

// GET /api/gyms — อ่านสาขาทั้งหมดหรือกรองด้วยค่าบริการสูงสุด; ผลลัพธ์คือ 200
app.get("/api/gyms", async (req, res) => {
  try {
    // query string ใช้กรองสาขาตามค่าบริการสูงสุด
    const { max_fee } = req.query;
    let sql = "SELECT * FROM gyms";
    const params = [];

    if (max_fee !== undefined) {
      const fee = parseFloat(max_fee);
      if (!Number.isFinite(fee) || fee < 0) {
        return res
          .status(400)
          .json({
            success: false,
            message: "max_fee must be a non-negative number",
          });
      }
      sql += " WHERE monthly_fee <= ?";
      params.push(fee);
    }

    sql += " ORDER BY id ASC";
    // pool.query คืน rows ที่อ่านได้; จัดรูปแบบพิกัดก่อนส่งตามชนิดใน OpenAPI
    const [rows] = await pool.query(sql, params);
    res.json({
      success: true,
      count: rows.length,
      data: rows.map(formatGymCoordinates),
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

// POST /api/gyms — ตรวจข้อมูลแล้วสร้างสาขาใหม่; ข้อมูลไม่ครบ/ผิดตอบ 400 และสำเร็จตอบ 201
app.post("/api/gyms", async (req, res) => {
  try {
    // ข้อมูลสาขาใหม่มาจาก JSON body; พิกัดเป็นข้อมูลเสริม
    const {
      name,
      address,
      monthly_fee,
      phone_number,
      latitude = null,
      longitude = null,
    } = req.body;
    if (!name || !address || monthly_fee == null || !phone_number) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: name, address, monthly_fee, phone_number",
      });
    }
    // DECIMAL ใน MySQL รับเฉพาะค่าตัวเลขที่ไม่ติดลบ; ปฏิเสธก่อนส่ง SQL
    if (
      typeof monthly_fee !== "number" ||
      !Number.isFinite(monthly_fee) ||
      monthly_fee < 0
    )
      return res
        .status(400)
        .json({
          success: false,
          message: "monthly_fee must be a non-negative number",
        });
    const coordinateError = validateGymCoordinates(req.body);
    if (coordinateError)
      return res.status(400).json({ success: false, message: coordinateError });
    // INSERT ใช้ ? แยกค่าจาก SQL และ insertId คือรหัสสาขาที่ฐานข้อมูลสร้างให้
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

// GET /api/gyms/:id — อ่านสาขาจาก ID; ถ้าไม่มีข้อมูลตอบ 404
app.get("/api/gyms/:id", async (req, res) => {
  try {
    // :id เป็น path parameter เช่น /api/gyms/2
    const [rows] = await pool.query("SELECT * FROM gyms WHERE id = ?", [
      req.params.id,
    ]);
    // 404 ใช้เมื่อ route ทำงานได้ แต่ไม่มีสาขารหัสนี้ในฐานข้อมูล
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

// PUT /api/gyms/:id — ตรวจและแก้ข้อมูลสาขาที่มีอยู่; ถ้าไม่พบตอบ 404
app.put("/api/gyms/:id", async (req, res) => {
  try {
    // PUT รับข้อมูลชุดใหม่ของสาขาและตรวจค่าก่อนแก้ฐานข้อมูล
    const { name, address, monthly_fee, phone_number } = req.body;
    if (!name || !address || monthly_fee == null || !phone_number) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: name, address, monthly_fee, phone_number",
      });
    }
    if (
      typeof monthly_fee !== "number" ||
      !Number.isFinite(monthly_fee) ||
      monthly_fee < 0
    )
      return res
        .status(400)
        .json({
          success: false,
          message: "monthly_fee must be a non-negative number",
        });
    const coordinateError = validateGymCoordinates(req.body);
    if (coordinateError)
      return res.status(400).json({ success: false, message: coordinateError });
    const [check] = await pool.query("SELECT id FROM gyms WHERE id = ?", [
      req.params.id,
    ]);
    if (check.length === 0)
      return res.status(404).json({ success: false, message: "Gym not found" });

    // PUT รุ่นเดิมที่ยังไม่ส่งพิกัดต้องไม่ลบพิกัดที่สาขามีอยู่แล้ว
    // ถ้าคำขอเก่าไม่ส่งพิกัด จะอัปเดตเฉพาะข้อมูลสาขาและรักษาพิกัดเดิมไว้
    const updateCoordinates =
      Object.hasOwn(req.body, "latitude") &&
      Object.hasOwn(req.body, "longitude");
    if (updateCoordinates) {
      await pool.query(
        "UPDATE gyms SET name=?, address=?, monthly_fee=?, phone_number=?, latitude=?, longitude=? WHERE id=?",
        [
          name,
          address,
          monthly_fee,
          phone_number,
          req.body.latitude,
          req.body.longitude,
          req.params.id,
        ],
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

// DELETE /api/gyms/:id — ลบสาขา; middleware บังคับ admin และฐานข้อมูลลบรายการลูกแบบ cascade
app.delete("/api/gyms/:id", async (req, res) => {
  try {
    // ตรวจว่ามีสาขาก่อนลบ; สิทธิ์ admin ถูกตรวจโดย middleware กลางด้านบน
    const [check] = await pool.query("SELECT id FROM gyms WHERE id = ?", [
      req.params.id,
    ]);
    if (check.length === 0)
      return res.status(404).json({ success: false, message: "Gym not found" });
    // ลบสาขา; foreign key แบบ cascade จะลบประวัติสมัครที่ผูกกับสาขานี้ด้วย
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

// GET /api/gyms/:gymId/memberships — JOIN ข้อมูลสมาชิกและการสมัครของสาขาที่ระบุ
app.get("/api/gyms/:gymId/memberships", async (req, res) => {
  try {
    // ตรวจสาขาก่อน แล้ว JOIN เพื่อได้ทั้งข้อมูลสมัครและชื่อสมาชิก/สาขา
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

// GET /api/members — อ่านรายชื่อสมาชิกทั้งหมด เรียงตาม ID
app.get("/api/members", async (req, res) => {
  try {
    // คืนสมาชิกทั้งหมดเรียงตาม ID เพื่อให้ลำดับผลลัพธ์คงที่
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

// POST /api/members — ตรวจฟิลด์และอีเมลซ้ำ (409) ก่อนสร้างสมาชิกใหม่
app.post("/api/members", async (req, res) => {
  try {
    // ข้อมูลสมาชิกที่ส่งมาจากฟอร์มอยู่ใน JSON body
    const { full_name, email, phone_number, join_date } = req.body;
    if (!full_name || !email || !phone_number || !join_date) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: full_name, email, phone_number, join_date",
      });
    }
    // อีเมลต้องไม่ซ้ำ เพื่อใช้ระบุตัวสมาชิกได้ไม่กำกวม
    const [dup] = await pool.query("SELECT id FROM members WHERE email = ?", [
      email,
    ]);
    if (dup.length > 0)
      return res
        .status(409)
        .json({ success: false, message: "Email already exists" });

    // เพิ่มสมาชิก แล้วใช้ insertId อ่านข้อมูลที่สร้างกลับไปตอบหน้าเว็บ
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

// GET /api/members/:id — อ่านรายละเอียดสมาชิกตามรหัสที่หน้าเว็บส่งมา
app.get("/api/members/:id", async (req, res) => {
  try {
    // ใช้รหัสจาก URL ค้นหาสมาชิก โดย ? ช่วยแยกค่าข้อมูลออกจากคำสั่ง SQL
    const [rows] = await pool.query("SELECT * FROM members WHERE id = ?", [
      req.params.id,
    ]);
    // ถ้าไม่พบรหัสนี้ ให้ตอบ 404 เพื่อแจ้งว่าหาสมาชิกไม่เจอ
    if (rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Member not found" });
    // ถ้าพบ ส่งข้อมูลสมาชิกแถวแรกกลับไปให้หน้าเว็บแสดงรายละเอียด
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    // หากเกิดข้อผิดพลาดระหว่างติดต่อฐานข้อมูล ให้ตอบ 500
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

// PUT /api/members/:id — ตรวจข้อมูลและแก้ไขสมาชิกตาม ID
app.put("/api/members/:id", async (req, res) => {
  try {
    // รับข้อมูลสมาชิกชุดใหม่ ตรวจว่ามีรหัสนี้ก่อน UPDATE
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

// DELETE /api/members/:id — ลบสมาชิก; จำกัด admin และประวัติสมัครที่ผูกไว้อาจถูกลบแบบ cascade
app.delete("/api/members/:id", async (req, res) => {
  try {
    // การลบถูกจำกัดเป็น admin โดย middleware; foreign key อาจลบประวัติสมัครที่ผูกอยู่ด้วย
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

// GET /api/memberships — อ่านประวัติสมัครพร้อมชื่อสมาชิกและชื่อสาขาจาก JOIN
app.get("/api/memberships", async (req, res) => {
  try {
    // JOIN เติมชื่อสมาชิกและชื่อสาขาให้หน้าเว็บ ไม่ต้องแสดงแต่ foreign key
    // เงื่อนไข ON จับคู่ foreign key กับ id ของตารางที่เกี่ยวข้อง
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

// POST /api/memberships — ตรวจสมาชิก/สาขา/วัน/สถานะ แล้วสร้างรายการสมัคร
app.post("/api/memberships", async (req, res) => {
  try {
    // การสมัครเชื่อม member กับ gym พร้อมช่วงวันที่และสถานะเริ่มต้น
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
    if (
      typeof start_date !== "string" ||
      typeof end_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(start_date) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(end_date) ||
      end_date < start_date
    )
      return res
        .status(400)
        .json({ success: false, message: "Invalid date range" });
    // ตรวจ foreign key ทั้งสองฝั่งก่อนสร้างความสัมพันธ์
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
    // แปลงเป็นตัวพิมพ์ใหญ่ก่อนตรวจและบันทึก เพื่อเก็บสถานะเป็นรูปแบบเดียวกัน
    if (
      typeof status !== "string" ||
      !validStatuses.includes(status.toUpperCase())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be ACTIVE, EXPIRED, or CANCELLED",
      });
    }

    // บันทึกประวัติสมัคร และคืนแถวที่เพิ่งสร้างให้หน้าเว็บ
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

// PUT /api/memberships/:id/status — เปลี่ยนสถานะของรายการสมัครที่ระบุ
app.put("/api/memberships/:id/status", async (req, res) => {
  try {
    // เปลี่ยนเฉพาะสถานะของรายการสมัครที่มีอยู่ โดยรับสถานะใหม่จาก JSON body
    const { status } = req.body;
    const validStatuses = ["ACTIVE", "EXPIRED", "CANCELLED"];
    if (!status) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required field: status" });
    }
    if (
      typeof status !== "string" ||
      !validStatuses.includes(status.toUpperCase())
    ) {
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

    // แก้เฉพาะ status ของรายการสมัครนี้ ไม่เปลี่ยนสมาชิก สาขา หรือช่วงวันที่
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
    // lat/lon ต้องส่งมาด้วยกัน; ถ้าไม่ส่งจะใช้พิกัดเริ่มต้นเป็นกรุงเทพฯ
    if ((req.query.lat === undefined) !== (req.query.lon === undefined)) {
      return res
        .status(400)
        .json({
          success: false,
          message: "lat and lon must be provided together",
        });
    }
    if (
      req.query.lat !== undefined &&
      (String(req.query.lat).trim() === "" ||
        String(req.query.lon).trim() === "")
    ) {
      return res
        .status(400)
        .json({ success: false, message: "lat and lon must be valid numbers" });
    }
    const lat = req.query.lat === undefined ? 13.7563 : Number(req.query.lat);
    const lon = req.query.lon === undefined ? 100.5018 : Number(req.query.lon);
    if (
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "lat must be between -90 and 90 and lon between -180 and 180",
        });
    }

    // service จัดการ timeout/retry/fallback; เมื่อรับพิกัดถูกต้อง route ส่งผลกลับเป็น JSON
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
// เปิดพอร์ตเมื่อสั่งรันไฟล์นี้โดยตรง; การ import app จากไฟล์ทดสอบจะไม่เปิดพอร์ตเอง
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Frontend   at http://localhost:${PORT}/app/`);
    console.log(`API Docs   at http://localhost:${PORT}/api-docs`);
  });
}

module.exports = app;
