// ใช้ secret เฉพาะชุดทดสอบ เพื่อให้ auth.js สร้างและตรวจ JWT ได้โดยไม่อ่านค่าจริงจากเครื่องผู้ใช้
process.env.JWT_SECRET = "test-only-secret-longer-than-thirty-two-chars";

// Supertest ส่ง HTTP request เข้า Express app ใน memory จึงไม่ต้องเปิดพอร์ต 3000 ระหว่างทดสอบ
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../src/index");
const pool = require("../db");

// Fixture กลางทำให้ทุก test ใช้ข้อมูลเดิมและคาดเดาผลลัพธ์ได้
const user = { id: 1, email: "staff@example.test", password_hash: bcrypt.hashSync("demo-password-123", 4), role: "staff" };
const member = { full_name: "Somchai", email: "somchai@example.test", phone_number: "0812345678", join_date: "2026-10-23" };

// จำลองเฉพาะ SQL; Supertest ยังทดสอบ middleware และ response ของ Express จริง
beforeEach(() => jest.spyOn(pool, "query").mockImplementation(async (sql) => {
  // คืนรูปแบบ [rows] ให้เหมือน mysql2/promise เพื่อให้ route ทำงานเหมือนต่อ DB จริง
  if (sql.includes("FROM users")) return [[sql.includes("password_hash") ? user : { id: user.id, email: user.email, role: user.role }]];
  if (sql.startsWith("SELECT id FROM members WHERE email")) return [[]];
  if (sql.startsWith("SELECT id FROM members")) return [[{ id: 9 }]];
  if (sql.startsWith("SELECT id FROM gyms")) return [[{ id: 2 }]];
  if (sql.startsWith("SELECT id FROM memberships")) return [[{ id: 9 }]];
  if (sql.startsWith("INSERT INTO")) return [{ insertId: 9 }];
  if (sql.startsWith("UPDATE") || sql.startsWith("DELETE")) return [{ affectedRows: 1 }];
  if (sql.includes("FROM memberships WHERE id")) return [[{ id: 9, status: "EXPIRED" }]];
  if (sql.includes("FROM members WHERE id")) return [[{ id: 9, ...member }]];
  if (sql.includes("FROM gyms")) return [[{ id: 2, name: "FitLife" }]];
  return [[]];
}));

// คืน implementation เดิมหลังแต่ละ test เพื่อไม่ให้ mock หรือ role จาก test หนึ่งรั่วไปอีก test
afterEach(() => jest.restoreAllMocks());

// ตัวช่วย Login ผ่าน endpoint จริงและคืน Authorization header สำหรับ request ที่ต้องยืนยันตัวตน
async function auth() {
  const result = await request(app).post("/api/auth/login").send({ email: user.email, password: "demo-password-123" });
  expect(result.status).toBe(200);
  return `Bearer ${result.body.token}`;
}

// ─────────────────────────────────────────────
// การเสิร์ฟหน้าเว็บและเส้นทางอ่านแบบ public
// ─────────────────────────────────────────────
test("serves demo frontend", async () => {
  const response = await request(app).get("/app/");
  expect(response.status).toBe(200);
  expect(response.text).toContain("เข้าสู่ระบบพนักงาน");
});
test("public read returns gyms", async () => {
  const response = await request(app).get("/api/gyms");
  expect(response.status).toBe(200);
  expect(response.body.data[0].name).toBe("FitLife");
});

// ─────────────────────────────────────────────
// Authentication และ Role-Based Access Control
// ─────────────────────────────────────────────
test("write without token is denied before SQL", async () => {
  const response = await request(app).post("/api/members").send(member);
  expect(response.status).toBe(401);
  expect(pool.query).not.toHaveBeenCalled();
});
test("login validates input, credentials, and me response", async () => {
  // แยกตรวจข้อมูลไม่ครบ, รหัสผิด และ token ที่ถูกต้อง รวมถึงห้ามส่ง password hash กลับ client
  expect((await request(app).post("/api/auth/login").send({})).status).toBe(400);
  expect((await request(app).post("/api/auth/login").send({ email: user.email, password: "wrong" })).status).toBe(401);
  const me = await request(app).get("/api/auth/me").set("Authorization", await auth());
  expect(me.body.user.role).toBe("staff");
  expect(me.body.user.password_hash).toBeUndefined();
});
test("invalid token and staff delete are denied", async () => {
  // token ผิดได้ 401 ส่วน staff ที่ login แล้วแต่ไม่มีสิทธิ์ลบได้ 403
  expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer wrong")).status).toBe(401);
  expect((await request(app).delete("/api/members/9").set("Authorization", await auth())).status).toBe(403);
});
test("staff creates member and rejects invalid payload", async () => {
  // middleware ต้องยอมให้ staff เขียนข้อมูล แต่ route ยังต้อง validate body อีกชั้น
  const header = await auth();
  expect((await request(app).post("/api/members").set("Authorization", header).send({ full_name: "Somchai" })).status).toBe(400);
  const good = await request(app).post("/api/members").set("Authorization", header).send(member);
  expect(good.status).toBe(201);
  expect(good.body.data.email).toBe(member.email);
});
test("staff creates membership and updates status", async () => {
  // ครอบคลุม use case สมัครแพ็กเกจและเปลี่ยนสถานะ พร้อมกรณี enum ไม่ถูกต้อง
  const header = await auth();
  const created = await request(app).post("/api/memberships").set("Authorization", header).send({ member_id: 9, gym_id: 2, start_date: "2026-10-23", end_date: "2026-12-23" });
  expect(created.status).toBe(201);
  expect((await request(app).put("/api/memberships/9/status").set("Authorization", header).send({ status: "BAD" })).status).toBe(400);
  const updated = await request(app).put("/api/memberships/9/status").set("Authorization", header).send({ status: "EXPIRED" });
  expect(updated.status).toBe(200);
  expect(updated.body.data.status).toBe("EXPIRED");
});
test("admin can delete; DB failure returns 500", async () => {
  // เปลี่ยน fixture เป็น admin ชั่วคราว แล้วคืนเป็น staff ใน finally แม้ assertion ล้มเหลว
  user.role = "admin";
  try {
    expect((await request(app).delete("/api/members/9").set("Authorization", await auth())).status).toBe(200);
    // บังคับให้ query ครั้งถัดไป throw เพื่อยืนยันว่า route แปลงปัญหา DB เป็น HTTP 500
    pool.query.mockRejectedValueOnce(new Error("database unavailable"));
    const failure = await request(app).get("/api/gyms");
    expect(failure.status).toBe(500);
    expect(failure.body.message).toBe("Internal server error");
  } finally { user.role = "staff"; }
});

// ─────────────────────────────────────────────
// Gyms: การกรองราคา, CRUD และพิกัด
// ─────────────────────────────────────────────
test("gym filter rejects invalid fee and passes numeric fee into parameterized SQL", async () => {
  // ตรวจทั้ง validation และยืนยันว่าค่าถูกส่งแยกจาก SQL ผ่าน placeholder
  expect((await request(app).get("/api/gyms?max_fee=-1")).status).toBe(400);
  const result = await request(app).get("/api/gyms?max_fee=1200");
  expect(result.status).toBe(200);
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("monthly_fee <= ?"), [1200]);
});

test("staff can create, read, and update a gym with validated monthly fee", async () => {
  // ใช้ flow เดียวกับหน้าเว็บ: ปฏิเสธค่าติดลบ แล้วทดสอบ POST → GET → PUT
  const header = await auth();
  const gym = { name: "FitLife Test", address: "Bangkok", monthly_fee: 1200, phone_number: "021234567" };
  expect((await request(app).post("/api/gyms").set("Authorization", header).send({ ...gym, monthly_fee: -1 })).status).toBe(400);
  expect((await request(app).post("/api/gyms").set("Authorization", header).send(gym)).status).toBe(201);
  expect((await request(app).get("/api/gyms/2")).status).toBe(200);
  expect((await request(app).put("/api/gyms/2").set("Authorization", header).send(gym)).status).toBe(200);
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE gyms SET"), expect.arrayContaining([1200, "2"]));
});

test("gym coordinates are optional, paired, and range checked", async () => {
  // พิกัดต้องส่งเป็นคู่ อยู่ในช่วง และส่ง null ทั้งคู่ได้เมื่อต้องการล้างพิกัด
  const header = await auth();
  const gym = { name: "FitLife Test", address: "Bangkok", monthly_fee: 1200, phone_number: "021234567" };
  expect((await request(app).post("/api/gyms").set("Authorization", header).send({ ...gym, latitude: 13.7 })).status).toBe(400);
  expect((await request(app).post("/api/gyms").set("Authorization", header).send({ ...gym, latitude: 91, longitude: 100 })).status).toBe(400);
  const created = await request(app).post("/api/gyms").set("Authorization", header).send({ ...gym, latitude: 13.7, longitude: 100.6 });
  expect(created.status).toBe(201);
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("latitude, longitude"), [gym.name, gym.address, gym.monthly_fee, gym.phone_number, 13.7, 100.6]);
  const updated = await request(app).put("/api/gyms/2").set("Authorization", header).send({ ...gym, latitude: null, longitude: null });
  expect(updated.status).toBe(200);
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("latitude=?, longitude=?"), [gym.name, gym.address, gym.monthly_fee, gym.phone_number, null, null, "2"]);
});

test("legacy gym update without coordinates preserves the coordinate columns", async () => {
  // Client รุ่นเก่าที่ไม่มี field พิกัดต้องแก้ข้อมูลหลักได้โดยไม่เขียนทับพิกัดเดิมใน DB
  const header = await auth();
  const gym = { name: "FitLife Test", address: "Bangkok", monthly_fee: 1200, phone_number: "021234567" };
  expect((await request(app).put("/api/gyms/2").set("Authorization", header).send(gym)).status).toBe(200);
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE gyms SET name=?, address=?, monthly_fee=?, phone_number=? WHERE id=?"), [gym.name, gym.address, gym.monthly_fee, gym.phone_number, "2"]);
});

// ─────────────────────────────────────────────
// Weather: validation ที่ขอบเขต HTTP ก่อนเรียก External API
// ─────────────────────────────────────────────
test("weather coordinates accept zero and reject incomplete or invalid ranges", async () => {
  // ค่า 0 เป็นพิกัดที่ถูกต้อง แต่ lat/lon ต้องมาคู่กันและอยู่ในช่วงมาตรฐาน
  expect((await request(app).get("/api/weather?lat=0")).status).toBe(400);
  expect((await request(app).get("/api/weather?lat=&lon=0")).status).toBe(400);
  expect((await request(app).get("/api/weather?lat=91&lon=0")).status).toBe(400);
});

// ─────────────────────────────────────────────
// Members และความสัมพันธ์ Memberships ของแต่ละสาขา
// ─────────────────────────────────────────────
test("member detail and update follow the same authenticated edit path as the UI", async () => {
  // GET อ่านรายละเอียดได้ ส่วน PUT ต้องมี token และข้อมูลที่จำเป็นครบ
  const header = await auth();
  const detail = await request(app).get("/api/members/9");
  expect(detail.status).toBe(200);
  expect(detail.body.data.email).toBe(member.email);
  expect((await request(app).put("/api/members/9").set("Authorization", header).send({ full_name: "Missing fields" })).status).toBe(400);
  const updated = await request(app).put("/api/members/9").set("Authorization", header).send({ ...member, full_name: "Updated Name" });
  expect(updated.status).toBe(200);
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE members SET"), expect.arrayContaining(["Updated Name", "9"]));
});

test("branch membership list and admin-only gym deletion", async () => {
  // ตรวจ endpoint รายการสมัครของสาขา แล้วสลับ role เพื่อพิสูจน์เส้นทาง DELETE ของ admin
  const branch = await request(app).get("/api/gyms/2/memberships");
  expect(branch.status).toBe(200);
  expect(branch.body.gym_name).toBe("FitLife");
  user.role = "admin";
  try {
    const header = await auth();
    expect((await request(app).delete("/api/gyms/2").set("Authorization", header)).status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith("DELETE FROM gyms WHERE id = ?", ["2"]);
  } finally { user.role = "staff"; }
});
