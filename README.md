# FitLife Gym API — Project Phase 3

ระบบบริหารสาขาฟิตเนส สมาชิก และการสมัครแพ็กเกจ ใช้ Express, MySQL และหน้าเว็บที่เรียก API จริง รหัสนิสิต 67160028, Pno 9

## โครงสร้างสำหรับรีวิว

| ตำแหน่ง | หน้าที่ |
| --- | --- |
| `backend/src/index.js` | Route สาขา สมาชิก การสมัคร สภาพอากาศ และ Swagger UI |
| `backend/src/auth.js` | Login, ตรวจ JWT และจำกัดสิทธิ์ admin |
| `backend/src/services/` | เรียก Open-Meteo พร้อม timeout/retry/fallback |
| `backend/db.js` | MySQL connection pool อ่านค่าจาก `.env` |
| `backend/migrate.js`, `backend/migrations/` | Migration แบบรันซ้ำได้; 001 สร้างข้อมูลหลัก, 002 สร้างบัญชีผู้ใช้ |
| `backend/scripts/` | สร้างบัญชี, ตรวจ migration/flow บนฐานข้อมูลทดสอบ, อัปเดตสัญญา API |
| `backend/tests/` | Jest/Supertest ครอบคลุม API; jsdom ตรวจสถานะหน้าเว็บ |
| `backend/openapi.yaml`, `backend/postman_collection.json` | สัญญา API และชุด request สำหรับสาธิต |
| `frontend/` | หน้าเว็บ, CSS, fetch API, สถานะโหลด/สำเร็จ/ผิดพลาด |
| `docs/` | เกณฑ์งาน, ERD, architecture, coverage, checklist และคู่มือ Demo |
| `lesson/` | เอกสารและ ZIP แล็บต้นทางจากอาจารย์ |
| `submissions/` | ZIP สำหรับส่งงาน |

`backend/index.js` เป็นไฟล์เดิมจากระยะก่อน; คำสั่ง `npm start` ใช้ `backend/src/index.js` โค้ดที่แก้มีคอมเมนต์ภาษาไทยอธิบายหน้าที่และเหตุผลที่สำคัญ

## เริ่มใช้งาน

1. เปิด MySQL และสร้างฐานข้อมูล `gym_db` หากยังไม่มี
2. คัดลอก `backend/.env.example` เป็น `backend/.env` ตั้งค่า DB และสร้าง `JWT_SECRET` แบบสุ่มยาว ไฟล์ `.env` ถูกละจาก Git/ZIP
3. ใน PowerShell:

```powershell
cd C:\Project-API\backend
npm ci
npm run db:migrate
npm run user:demo
npm start
```

`npm run user:demo` สร้างบัญชี staff และ admin พร้อมรหัสสุ่มสำหรับเครื่องนี้ เก็บเฉพาะ `backend/.demo-credentials` ซึ่งไม่รวมใน ZIP ใช้ `npm run user:create` เมื่อต้องการกำหนดบัญชีเองผ่านตัวแปร `GYM_USER_EMAIL`, `GYM_USER_PASSWORD` (12 อักขระขึ้นไป) และ `GYM_USER_ROLE=staff|admin` อย่าส่งรหัสผ่านให้อาจารย์ในเอกสาร

เปิด `http://localhost:3000/app/` สำหรับหน้าเว็บ และ `http://localhost:3000/api-docs` สำหรับ Swagger อ่านข้อมูลได้ก่อนล็อกอิน การเพิ่ม/แก้ไขต้องใช้ staff หรือ admin; ปุ่มลบแสดงเฉพาะ admin และ API ตรวจสิทธิ์ซ้ำ การลบสมาชิก/สาขาจะลบประวัติการสมัครที่เกี่ยวข้องด้วย Token มีอายุ 2 ชั่วโมง และหน้าเว็บเก็บไว้ใน `sessionStorage` ของแท็บปัจจุบัน

## Flow ที่สาธิต

```text
Login POST /api/auth/login → ได้ JWT → กรอกสมาชิก POST /api/members
→ สมัครแพ็กเกจ (สมาชิกใหม่จะถูกเลือกให้ต่ออัตโนมัติ) → กด “บันทึก” เพื่อเปลี่ยนสถานะและ “คืนค่าเดิม” เพื่อย้อน PUT /api/memberships/:id/status
→ GET /api/memberships ยืนยันข้อมูลที่บันทึกใน MySQL
```

ฟังก์ชัน `api()` ใน `frontend/app.js` แนบ Bearer token และแปลง HTTP/network error เป็นข้อความ `load()` ดึงสาขา สมาชิก และการสมัครพร้อมกัน ฟอร์มใช้ HTML validation เพิ่มการตรวจช่วงวันที่ หน้าเว็บแสดงสถานะกำลังโหลด ผลสำเร็จ และข้อผิดพลาดอย่างชัดเจน API ใช้ parameterized SQL และตอบ `{success, data}` หรือ `{success:false, message}`

## ตรวจงานและหลักฐาน

```powershell
cd C:\Project-API\backend
npx jest --runInBand --coverage
npm run test:integration
node scripts/check-demo-account.js
```

Jest/Supertest mock SQL จึงไม่แตะฐานข้อมูลจริง ส่วน `test:integration` สร้างฐานข้อมูลทดสอบชื่อเฉพาะ รัน migration สองรอบ ทดสอบ flow HTTP บน MySQL จริง แล้วลบฐานข้อมูลทดสอบใน `finally` ข้อมูลเดิมใน `gym_db` ไม่ถูกลบ `check-demo-account.js` ตรวจ login/session/สาขาในฐานข้อมูลนำเสนอโดยไม่พิมพ์รหัส รายงาน coverage อยู่ที่ `docs/coverage-report.md`

ไฟล์ที่ใช้ประกอบการนำเสนอ: `docs/DEMO-GUIDE.md`, `docs/clo-requirements-checklist.md`, `docs/architecture-week13.md`, `docs/erd.pdf` และ PDF เกณฑ์อาจารย์ใน `docs/` เอกสารสัปดาห์ที่ 14 เรื่อง migration/scale เป็นแบบฝึกออกแบบ ไม่ใช่ฟีเจอร์ที่อ้างว่าส่งคะแนน
