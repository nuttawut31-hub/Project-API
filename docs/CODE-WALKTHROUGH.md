# คู่มืออธิบาย Scope และเปิดโค้ดแต่ละ Phase

คู่มือนี้ใช้สำหรับซ้อมตอบอาจารย์ โดยเปิดโค้ดจากระบบปัจจุบันซึ่งรวมทั้ง 3 Phase แล้ว ไฟล์หลักที่ต้องเปิดคือ `backend/src/index.js` ส่วน `backend/index.js` เป็นโค้ดรุ่นแรกที่เก็บไว้เป็นประวัติและไม่ได้ถูกเรียกโดย `npm start`

## ภาพรวมสั้นที่สุด

| Phase | Scope | ประโยคที่ใช้พูด |
| --- | --- | --- |
| Phase 1 | Requirement, ฐานข้อมูล และ REST API ของสาขา สมาชิก และการสมัคร | “Phase 1 สร้างแกนข้อมูลของระบบและ CRUD ที่เชื่อม MySQL” |
| Phase 2 | เชื่อม External API และรับมือ timeout/error ด้วย retry และ fallback | “Phase 2 เพิ่ม Open-Meteo โดยแยก service และไม่ปล่อยให้บริการภายนอกทำระบบหลักล่ม” |
| Phase 3 | รวมระบบทั้งหมด เพิ่มหน้าเว็บจริง การล็อกอิน สิทธิ์ OpenAPI และหลักฐานทดสอบ | “Phase 3 ทำให้ระบบพร้อมสาธิตตั้งแต่หน้าเว็บถึงฐานข้อมูล พร้อมสัญญา API และผลทดสอบ” |

## Phase 1 — ข้อมูลหลักและ REST API

### Scope

- กำหนดปัญหา ผู้ใช้ และ Use Case ใน `docs/requirement.md`
- ออกแบบ `gyms`, `members` และ `memberships`
- ความสัมพันธ์คือสาขา 1:N การสมัคร และสมาชิก 1:N การสมัคร ดังนั้นสมาชิกกับสาขาจึงเป็น M:N ผ่าน `memberships`
- สร้าง CRUD API และเชื่อม MySQL ด้วย connection pool
- มี `schema.sql` สำหรับโครงสร้างและ `seed.sql` สำหรับข้อมูลตัวอย่าง

### เปิดโค้ดตรงไหน

1. `backend/schema.sql` — ชี้ 3 ตารางหลัก, foreign key และ `ON DELETE CASCADE`
2. `backend/db.js` — ชี้ `mysql2/promise`, ค่า `.env` และ connection pool
3. `backend/src/index.js`
   - บรรทัดประมาณ 113–350: API สาขา
   - บรรทัดประมาณ 366–510: API สมาชิก
   - บรรทัดประมาณ 520–670: API การสมัครและสถานะ
4. `backend/seed.sql` — ข้อมูลตัวอย่างที่ใช้สาธิต

### อธิบายกับหน้าเว็บ

- ส่วน “สาขาฟิตเนส” มาจาก `GET /api/gyms`
- ส่วน “สมาชิก” มาจาก `GET /api/members`
- ส่วน “สถานะการสมัคร” มาจาก `GET /api/memberships`
- เมื่อเพิ่มหรือแก้ข้อมูล หน้าเว็บส่ง `POST` หรือ `PUT` แล้วโหลดข้อมูลจาก MySQL ใหม่

### คำตอบเมื่อถูกถามว่าทำไมต้องมี memberships

“สมาชิกหนึ่งคนสมัครหลายสาขาหรือสมัครหลายช่วงเวลาได้ จึงไม่เก็บ `gym_id` ไว้ในสมาชิกโดยตรง แต่ใช้ `memberships` เป็นตารางกลางและเก็บวันเริ่ม วันสิ้นสุด และสถานะของแต่ละครั้ง”

## Phase 2 — External API และ Failure Handling

### Scope

- เชื่อม Open-Meteo เพื่ออ่านสภาพอากาศตามพิกัดสาขา
- กำหนด timeout เพื่อไม่ให้ request ค้าง
- retry เฉพาะ network error, HTTP 429 และ HTTP 5xx
- ใช้ exponential backoff พร้อม jitter ก่อนลองใหม่
- หากลองแล้วยังล้มเหลว คืน fallback ที่หน้าเว็บอธิบายได้ แทนการทำให้ระบบ crash
- บันทึกผลใน `docs/failure-scenario-results.md`

### เปิดโค้ดตรงไหน

1. `backend/src/services/external-api.js`
   - `isRetryable()` ตัดสินใจว่า error ใดควรลองใหม่
   - `fetchWithRetry()` จัดการ timeout, retry และเวลารอ
2. `backend/src/services/weather-service.js`
   - `getWeatherData()` สร้าง URL ของ Open-Meteo
   - success คืนข้อมูลจริง; catch คืน fallback
3. `backend/src/index.js` บรรทัดประมาณ 677 เป็นต้นไป
   - `GET /api/weather` ตรวจช่วง latitude/longitude แล้วเรียก service
4. `docs/failure-scenario-results.md`
   - หลักฐาน network error, timeout และ HTTP 500

### อธิบายกับหน้าเว็บ

1. ผู้ใช้เลือกสาขาใน dropdown
2. `frontend/app.js` อ่าน latitude/longitude ของสาขา
3. กด “ดูสภาพอากาศ” แล้วหน้าเว็บเรียก `/api/weather?lat=...&lon=...`
4. Backend เรียก Open-Meteo ผ่าน weather service
5. ถ้าสำเร็จ แสดงอุณหภูมิ ลม และเวลาอัปเดต
6. ถ้าล้มเหลว แสดงข้อความ fallback โดยงานสมาชิกและสาขายังใช้งานต่อได้

## Phase 3 — Integration, Security, Frontend และหลักฐาน

### Scope

- รวม API จาก Phase 1 และ External API จาก Phase 2 ให้ทำงานในแอปเดียว
- เพิ่มหน้าเว็บที่เรียก API จริง ไม่ใช้ข้อมูลจำลองใน HTML
- เพิ่ม login ด้วย JWT และแบ่ง role `staff`/`admin`
- GET อ่านได้ทั่วไป, POST/PUT ต้อง login และ DELETE ต้องเป็น admin
- ให้ Swagger UI อ่าน `openapi.yaml` ที่ `/api-docs`
- มี Postman collection, Jest/Supertest, coverage และ failure evidence
- จัด migration เพื่ออัปเดตฐานข้อมูลเดิมโดยไม่ลบข้อมูล

### เปิดโค้ดตรงไหน

1. `backend/src/auth.js`
   - `login()` ตรวจ bcrypt และออก JWT อายุ 2 ชั่วโมง
   - `requireAuth()` ตรวจ Bearer token และตรวจผู้ใช้ซ้ำกับ DB
   - `requireAdmin()` จำกัดการลบให้ admin
2. `backend/src/index.js` บรรทัดประมาณ 95–106
   - route login และ middleware กลางสำหรับสิทธิ์
3. `frontend/index.html`
   - โครงหน้าและฟอร์ม: login, สมาชิก, การสมัคร, สาขา และอากาศ
4. `frontend/app.js`
   - `api()` บรรทัดประมาณ 121: เรียก API และแนบ Bearer token
   - `load()` บรรทัดประมาณ 512: โหลดข้อมูลหลักพร้อมกัน
   - login บรรทัดประมาณ 549
   - เพิ่ม/แก้สาขา บรรทัดประมาณ 569
   - เพิ่ม/แก้สมาชิก บรรทัดประมาณ 678
   - สมัครแพ็กเกจ บรรทัดประมาณ 725
5. `backend/openapi.yaml` และ `backend/postman_collection.json`
6. `backend/tests/` และ `docs/coverage-report.md`

## เส้นทางจากการคลิกหน้าเว็บไปถึงฐานข้อมูล

### ตัวอย่าง: เพิ่มสมาชิก

```text
frontend/index.html ฟอร์มสมาชิก
  → frontend/app.js submit handler
  → api("/api/members", { method: "POST" })
  → backend/src/index.js POST /api/members
  → middleware ตรวจ JWT
  → pool.query("INSERT INTO members ...", params)
  → MySQL
  → JSON response
  → load() โหลดรายการใหม่
  → renderMembers() แสดงสมาชิกบนหน้าเว็บ
```

จุดที่ควรเปิดตามลำดับ:

1. `frontend/index.html` บรรทัดประมาณ 98–140
2. `frontend/app.js` บรรทัดประมาณ 678–705
3. `backend/src/index.js` บรรทัดประมาณ 382–425
4. `backend/db.js`

### ตัวอย่าง: สมัครแพ็กเกจ

```text
เลือกสมาชิก + สาขา + วันที่
  → frontend/app.js ตรวจว่าวันสิ้นสุดไม่ก่อนวันเริ่ม
  → POST /api/memberships
  → Backend ตรวจ member_id และ gym_id
  → INSERT memberships
  → โหลดตารางสถานะใหม่
```

จุดที่ควรเปิด:

1. `frontend/index.html` บรรทัดประมาณ 147–215
2. `frontend/app.js` บรรทัดประมาณ 724–745
3. `backend/src/index.js` บรรทัดประมาณ 543–622

### ตัวอย่าง: เปลี่ยนสถานะ

```text
เลือกสถานะในตาราง
  → ปุ่มบันทึกปรากฏโดยไม่เลื่อน layout
  → PUT /api/memberships/:id/status
  → UPDATE memberships SET status = ?
  → หน้าเว็บโหลดสถานะจริงจากฐานข้อมูล
```

จุดที่ควรเปิด:

1. `frontend/app.js` บรรทัดประมาณ 417–503
2. `backend/src/index.js` บรรทัดประมาณ 623–676

### ตัวอย่าง: Login และสิทธิ์

```text
กรอก email/password
  → POST /api/auth/login
  → bcrypt.compare กับ password_hash
  → ได้ JWT
  → หน้าเว็บเก็บ token ใน sessionStorage
  → api() แนบ Authorization: Bearer <token>
  → middleware อนุญาตหรือคืน 401/403
```

จุดที่ควรเปิด:

1. `frontend/app.js` บรรทัดประมาณ 121–148 และ 549–567
2. `backend/src/auth.js`
3. `backend/src/index.js` บรรทัดประมาณ 95–106

## ลำดับเปิดไฟล์เมื่ออาจารย์ขอดูโค้ด

เปิดเพียง 6 แท็บนี้ก่อนเพื่อไม่ให้สับสน:

1. `frontend/index.html` — หน้าตาและฟอร์ม
2. `frontend/app.js` — เหตุการณ์คลิกและ fetch
3. `backend/src/index.js` — route, validation และ SQL
4. `backend/src/auth.js` — login/JWT/RBAC
5. `backend/src/services/external-api.js` — retry/timeout
6. `backend/src/services/weather-service.js` — success/fallback

ถ้าถามฐานข้อมูลจึงเปิด `backend/schema.sql` และ `backend/db.js`; ถ้าถามสัญญา API เปิด `/api-docs`; ถ้าถามคุณภาพเปิด `backend/tests/api.test.js` กับ `docs/coverage-report.md`

## บทพูดสรุปประมาณ 40 วินาที

“โครงงานแบ่งเป็นสามระยะครับ Phase 1 ผมออกแบบข้อมูลสาขา สมาชิก และการสมัคร แล้วสร้าง REST API เชื่อม MySQL Phase 2 ผมเพิ่ม Open-Meteo และทำ timeout, retry และ fallback เพื่อให้บริการภายนอกล่มแล้วระบบหลักยังทำงาน Phase 3 ผมรวมทุกส่วนเข้ากับหน้าเว็บ เพิ่ม JWT และ role ของ staff/admin ทำ OpenAPI, Postman และการทดสอบ เวลาใช้หน้าเว็บ JavaScript จะเรียก Express API จากนั้น route ตรวจข้อมูลและสิทธิ์ก่อนใช้ parameterized SQL กับ MySQL แล้วส่งผลกลับมา render ใหม่ครับ”

