# รายงานการทดสอบและ Coverage — Phase 3

รันจาก `backend/` ด้วย `npm run test:coverage -- --silent` วันที่ 24 ตุลาคม 2026: **22/22 tests ผ่าน**, line coverage รวม **74.13%** (หลักฐานดิบ `docs/coverage-summary.json`)

| ไฟล์ที่ coverage ต่ำสุด | Lines | ขอบเขตที่ยังขาด |
| --- | ---: | --- |
| `src/index.js` | 68.68% | error 500 และกรณีไม่พบข้อมูลของบาง route, weather route |
| `src/auth.js` | 84.37% | ข้อผิดพลาดของฐานข้อมูลระหว่าง login และตรวจ token |
| `src/services/external-api.js` | 100% | บรรทัดครบแล้ว; branch coverage 81.81% ยังมีทางเลือกย่อยที่ไม่ถูกเรียก |

`src/services/weather-service.js` มี line และ branch coverage 100% ชุดทดสอบใหม่ตรวจ HTTP retry เมื่อ 429/5xx, หยุดเมื่อ 400, timeout parameter, ข้อมูลสำเร็จ และ fallback เมื่อบริการภายนอกล้มเหลว โดย mock HTTP ภายนอก ไม่เรียกเครือข่ายจริง

Jest/Supertest ตรวจ auth 401/403, public GET, การกรองราคา, เพิ่ม/อ่าน/แก้ไขสาขา, ดูการสมัครแยกตามสาขา, เพิ่ม/อ่าน/แก้ไขสมาชิก, การสมัคร, เปลี่ยนสถานะ และ admin ลบสาขา/สมาชิก ส่วน `backend/tests/frontend.test.js` ตรวจสถานะโหลด สำเร็จ ข้อผิดพลาด การเปิดฟอร์มหลังเข้าสู่ระบบ และรายละเอียดสมาชิก/สาขาที่เปิดใกล้รายการที่เลือก

Coverage ข้างต้นวัดเฉพาะ `backend/src/`; การทดสอบหน้าเว็บไม่เพิ่มเปอร์เซ็นต์ วันที่ 24 ตุลาคม 2026 รัน `npm run test:integration` ผ่านบน MySQL ชั่วคราว: migration สองรอบ, login, เพิ่มสมาชิก, สมัครแพ็กเกจ, เปลี่ยนสถานะ และอ่านรายการ โดยไม่แก้ข้อมูลฐานนำเสนอ
