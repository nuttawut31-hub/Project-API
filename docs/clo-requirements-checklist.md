# CLO Checklist — Project Phase 3

เทียบ `wk15.pdf` และ `wk15-project-phase3.pdf` ณ 23 ตุลาคม 2026

| ข้อกำหนด | สถานะ | หลักฐานที่เปิดให้ดู |
| --- | --- | --- |
| ระบบรวมกับ MySQL | ผ่าน flow หลัก | `backend/src/index.js`, `backend/db.js`, `backend/scripts/integration-check.js`; ผลรันใน `docs/coverage-report.md` |
| Integration ระยะ 1–2 | ผ่าน | Route Gym/Member/Membership และ Open-Meteo ใน `backend/src/` |
| Authentication/RBAC | ผ่าน | `backend/src/auth.js`, `backend/migrations/002_auth.sql`, Jest 401/403; staff/admin เขียน, admin ลบ |
| OpenAPI ตรง route และสิทธิ์ | ผ่าน static audit | `backend/openapi.yaml`; `node backend/scripts/audit-contract.js` ตรวจ 17 path/method และ auth errors |
| Postman สำหรับสาธิต | พร้อม | `backend/postman_collection.json` มี Login เก็บ token และ Bearer สำหรับ write request |
| Migration รักษาข้อมูลเดิม | ผ่าน | `backend/migrate.js`, `001_initial.sql`, `002_auth.sql`; integration รันสองรอบแล้วข้ามเวอร์ชันที่ลงแล้ว |
| Jest/Supertest และ coverage | ผ่านตามกรณีหลัก | `backend/tests/api.test.js`, `backend/tests/services.test.js`, `docs/coverage-report.md`: 22 tests ผ่าน, lines 74.13%, ระบุ 3 ไฟล์ต่ำสุด |
| หน้าเว็บเรียก API อย่างน้อย 3 endpoint | ผ่าน | `frontend/app.js` เรียก GET 3, POST 2, PUT 1 และ auth 2 |
| Loading, success, error, validation | ผ่านใน use case หลัก | `frontend/index.html`, `frontend/app.js`, `frontend/style.css`, `backend/tests/frontend.test.js` |
| Demo สด 5–7 นาที | มีบทและบัญชีสาธิต | `docs/DEMO-GUIDE.md`; `backend/scripts/check-demo-account.js` ผ่านบนเครื่องนี้; ต้องเปิด MySQL และซ้อมบนเครื่องที่จะนำเสนอจริง |
| ออกแบบสถาปัตยกรรมสัปดาห์ที่ 13 | ผ่านแบบเอกสาร | `docs/architecture-week13.md`; ระบบที่ส่งยังเป็น monolith |
| ZIP ส่งงาน | พร้อม | `submissions/project-phase3-67160028-9.zip`; ไม่มี `.env`, `.demo-credentials`, `node_modules` |

สัปดาห์ที่ 14 เป็นแบบฝึกออกแบบ ไม่อ้างว่า Knex/cluster/ระบบ scale ถูกพัฒนาเพื่อคะแนนงานนี้
