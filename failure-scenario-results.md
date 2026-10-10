# บันทึกผลการทดสอบ Failure Scenario — External API Resilience

**โครงงาน:** Gym Membership Management API (ระยะที่ 2)  
**รหัสนิสิต:** 67160028 | **Pno:** 9  
**External API ที่เชื่อมต่อ:** Open-Meteo Weather API (`https://api.open-meteo.com/v1/forecast`)  
**วัตถุประสงค์ในระบบ:** ดึงสภาพอากาศเพื่อแนะนำสมาชิกฟิตเนสในการวางแผนกิจกรรมออกกำลังกาย (เช่น ออกกำลังกายกลางแจ้ง หรือเข้าใช้บริการที่สาขาฟิตเนสในร่ม)

---

## 1. สถาปัตยกรรมความทนทาน (Resilience Architecture)

ระบบถูกออกแบบแยก Layer ชัดเจนตามรูปแบบปฏิบัติการสัปดาห์ที่ 11:

1. **`src/services/external-api.js` (Retry Engine):**
   - ฟังก์ชัน `fetchWithRetry(url, timeoutMs = 3000, maxRetries = 2)`
   - ตรวจสอบ Error ผ่าน `isRetryable(error)`:
     - Network Error / Timeout (ไม่มี `error.response`) → **Retry**
     - HTTP 429 (Too Many Requests) → **Retry**
     - HTTP 5xx (Server Error) → **Retry**
     - HTTP 4xx อื่น ๆ (Client Error เช่น 400, 404) → **ไม่ Retry** (โยน error ทันที)
   - กลยุทธ์ **Exponential Backoff + Equal Jitter**:
     $$\text{baseBackoffMs} = 2^{(\text{attempt} - 1)} \times 1000$$
     $$\text{backoffMs} = \frac{\text{baseBackoffMs}}{2} + \text{Math.random()} \times \frac{\text{baseBackoffMs}}{2}$$
     - Attempt 1: ช่วง $500\text{ ms} - 1000\text{ ms}$
     - Attempt 2: ช่วง $1000\text{ ms} - 2000\text{ ms}$
     - ช่วยป้องกันปัญหา Thundering Herd เมื่อบริการภายนอกฟื้นตัว

2. **`src/services/weather-service.js` (Business Logic & Fallback Layer):**
   - เรียก `fetchWithRetry(url, 3000, 2)`
   - เมื่อสำเร็จ: คืนข้อมูลสภาพอากาศพร้อม `source: "external"`, `available: true`
   - เมื่อล้มเหลวครบทุก Retry: จัดการข้อผิดพลาดและคืนค่า **Fallback Object** ทันที พร้อม `source: "fallback"`, `available: false`, ค่าสภาพอากาศเป็น `null` และ `note` แจ้งเตือนผู้ใช้อย่างสุภาพ

3. **`src/index.js` (API Route):**
   - Endpoint `GET /api/weather?lat=...&lon=...`
   - ตอบกลับ HTTP 200 เสมอ พร้อมโครงสร้าง `{ data: { weather } }` ทำให้ระบบไม่เกิดข้อผิดพลาด 500 หรือค้าง (Hang)

---

## 2. ตารางสรุปผลการทดสอบ Failure Scenario

_(อ้างอิงตามแบบฟอร์มการประเมินในคู่มือปฏิบัติการสัปดาห์ที่ 11 จุดตรวจสอบที่ 3)_

| สถานการณ์                                 | วิธีจำลอง                                                                           | ผลลัพธ์ที่คาดหวัง                              | ผลลัพธ์จริง                                                                                    | ผ่าน/ไม่ผ่าน |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | :----------: |
| **1. Network error (โดเมนไม่มีอยู่จริง)** | เปลี่ยน URL เป็นโดเมนปลอม `https://nonexistent-domain-xyz-404.example.com/forecast` | Retry 2 ครั้ง แล้ว fallback พร้อมข้อความชัดเจน | Retry 2 ครั้ง (Log แสดง delay ~792ms, ~1715ms ตาม Jitter) แล้วคืน `source: "fallback"` ครบถ้วน |   **ผ่าน**   |
| **2. Timeout**                            | ตั้งค่า `timeoutMs = 1` เพื่อให้เวลาหมดก่อนที่ Server ภายนอกจะตอบกลับ               | เกิด timeout (ECONNABORTED) แล้ว fallback      | เกิด timeout of 1ms exceeded ตามที่คาด มีการ Retry 2 ครั้ง แล้ว fallback ถูกต้อง               |   **ผ่าน**   |
| **3. External API คืน 500**               | จำลอง Mock HTTP Server บนพอร์ต 4000 ที่ส่งคืน HTTP 500 Internal Server Error        | Retry เนื่องจากเป็น 5xx แล้ว fallback          | Retry 2 ครั้งตามที่คาด (Log แสดง delay ~551ms, ~1905ms) แล้ว fallback ถูกต้อง                  |   **ผ่าน**   |

---

## 3. รายละเอียดผลการทดสอบรายสถานการณ์

### สถานการณ์ที่ 1: Network Error (โดเมนไม่มีอยู่จริง)

- **วิธีจำลอง:** กำหนด URL เป็นโดเมนที่ไม่มีในระบบ DNS (`https://nonexistent-domain-xyz-404.example.com/forecast`)
- **Console Log จากระบบ:**
  ```text
  [external-api] request to https://nonexistent-domain-xyz-404.example.com/forecast failed (attempt 1/2): getaddrinfo ENOTFOUND nonexistent-domain-xyz-404.example.com. Retrying in 792ms
  [external-api] request to https://nonexistent-domain-xyz-404.example.com/forecast failed (attempt 2/2): getaddrinfo ENOTFOUND nonexistent-domain-xyz-404.example.com. Retrying in 1715ms
  [weather-service] external API unavailable after retries: getaddrinfo ENOTFOUND nonexistent-domain-xyz-404.example.com
  Network Error Elapsed: 2792ms
  ```
- **Response ที่คืนให้ Client (HTTP 200):**
  ```json
  {
    "data": {
      "weather": {
        "source": "fallback",
        "available": false,
        "temperature": null,
        "windspeed": null,
        "weathercode": null,
        "time": null,
        "note": "ไม่สามารถดึงข้อมูลสภาพอากาศจากบริการภายนอกได้ในขณะนี้ กรุณาลองใหม่ภายหลัง"
      }
    }
  }
  ```
- **วิเคราะห์:** ตรวจพบ `ENOTFOUND` จัดเป็น Network Error (`!error.response`) จึงทำการ Retry 2 ครั้ง พร้อมหน่วงเวลา Equal Jitter (792ms และ 1715ms) ก่อนเข้าสู่ Fallback สำเร็จ

---

### สถานการณ์ที่ 2: Timeout (`timeoutMs = 1`)

- **วิธีจำลอง:** ตั้งเวลา Timeout ไว้สั้นมากคือ 1 มิลลิวินาที ทำให้คำขอถูกยกเลิกเนื่องจากหมดเวลา
- **Console Log จากระบบ:**
  ```text
  [external-api] request to https://api.open-meteo.com/v1/forecast?latitude=13.7563&longitude=100.5018&current_weather=true&forecast_days=1 failed (attempt 1/2): timeout of 1ms exceeded. Retrying in 719ms
  [external-api] request to https://api.open-meteo.com/v1/forecast?latitude=13.7563&longitude=100.5018&current_weather=true&forecast_days=1 failed (attempt 2/2): timeout of 1ms exceeded. Retrying in 1843ms
  [weather-service] external API unavailable after retries: timeout of 1ms exceeded
  Timeout Elapsed: 2615ms
  ```
- **Response ที่คืนให้ Client (HTTP 200):**
  ```json
  {
    "data": {
      "weather": {
        "source": "fallback",
        "available": false,
        "temperature": null,
        "windspeed": null,
        "weathercode": null,
        "time": null,
        "note": "ไม่สามารถดึงข้อมูลสภาพอากาศจากบริการภายนอกได้ในขณะนี้ กรุณาลองใหม่ภายหลัง"
      }
    }
  }
  ```
- **วิเคราะห์:** เมื่อเกิด Timeout ข้อผิดพลาดไม่มี `response` (`isRetryable` ส่งค่า `true`) ระบบ Retry 2 ครั้ง (719ms และ 1843ms) และ Fallback ทำงานถูกต้อง ไม่เกิด Request ค้าง

---

### สถานการณ์ที่ 3: External API คืนค่า 500 (Internal Server Error)

- **วิธีจำลอง:** รัน Mock HTTP Server จำลองที่พอร์ต 4000 ตอบกลับ HTTP 500
- **Console Log จากระบบ:**
  ```text
  Mock failing server running on port 4000
  [external-api] request to http://localhost:4000 failed (attempt 1/2): Request failed with status code 500. Retrying in 551ms
  [external-api] request to http://localhost:4000 failed (attempt 2/2): Request failed with status code 500. Retrying in 1905ms
  [weather-service] external API unavailable after retries: Request failed with status code 500
  500 Error Elapsed: 2488ms
  ```
- **Response ที่คืนให้ Client (HTTP 200):**
  ```json
  {
    "data": {
      "weather": {
        "source": "fallback",
        "available": false,
        "temperature": null,
        "windspeed": null,
        "weathercode": null,
        "time": null,
        "note": "ไม่สามารถดึงข้อมูลสภาพอากาศจากบริการภายนอกได้ในขณะนี้ กรุณาลองใหม่ภายหลัง"
      }
    }
  }
  ```
- **วิเคราะห์:** HTTP 500 เข้าเงื่อนไข `status >= 500 && status < 600` ของ `isRetryable` ระบบ Retry ครบ 2 ครั้ง (551ms และ 1905ms) และส่งมอบ Fallback ตอบกลับผู้ใช้โดยเซิร์ฟเวอร์ไม่ Crash

---

### กรณีปกติ: Normal Success Case (Open-Meteo API)

- **วิธีทดสอบ:** เรียก `GET /api/weather` โดยระบุพิกัดกรุงเทพฯ (13.7563, 100.5018)
- **Response ที่คืนให้ Client (HTTP 200):**
  ```json
  {
    "data": {
      "weather": {
        "source": "external",
        "available": true,
        "temperature": 25.4,
        "windspeed": 7.9,
        "weathercode": 95,
        "time": "2026-10-10T15:00",
        "note": null
      }
    }
  }
  ```
- **วิเคราะห์:** ข้อมูลสภาพอากาศดึงได้ถูกต้องใน Attempt แรก ไม่มีการ Retry และระบุ `source: "external"` ชัดเจน

---

## 5. สรุปพฤติกรรมระบบ

| สถานการณ์                 | Retry             | Fallback | Response             |
| ------------------------- | ----------------- | -------- | -------------------- |
| API ตอบสนองปกติ           | ไม่ retry         | ไม่ใช้   | `source: "external"` |
| Network error (ENOTFOUND) | 2 ครั้ง + backoff | ใช้      | `source: "fallback"` |
| Timeout (ECONNABORTED)    | 2 ครั้ง + backoff | ใช้      | `source: "fallback"` |
| 4xx error (client error)  | ไม่ retry         | ใช้      | `source: "fallback"` |
| 5xx error (server error)  | 2 ครั้ง + backoff | ใช้      | `source: "fallback"` |

**ข้อสรุป:** ระบบไม่ crash เมื่อ External API ล้มเหลวในทุกกรณี โดย Fallback คืนค่า default
ที่มีความหมายให้ผู้ใช้เข้าใจได้ แทนที่จะแสดง error 500 โดยตรง
