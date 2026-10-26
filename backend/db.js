// mysql2/promise ทำให้ route ใช้ async/await กับคำสั่ง SQL ได้โดยตรง
const mysql = require("mysql2/promise");

// โหลดค่าการเชื่อมต่อจาก backend/.env เพื่อไม่เขียนรหัสฐานข้อมูลไว้ใน source code
require("dotenv").config();

// Connection pool เปิด connection ไว้ใช้ซ้ำหลาย request ลดค่าใช้จ่ายจากการเชื่อมต่อใหม่ทุกครั้ง
const pool = mysql.createPool({
  // มีค่าเริ่มต้นสำหรับเครื่องพัฒนา แต่ตอนนำเสนอควรกำหนดทุกค่าใน .env
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "gym_db",

  // DATE เป็นวันที่ปฏิทิน ไม่มี timezone; คืนเป็น YYYY-MM-DD เพื่อไม่ให้หน้าเว็บเลื่อนวัน
  dateStrings: ["DATE"],

  // เมื่อ connection ทั้ง 10 ตัวถูกใช้งาน ให้ request ใหม่รอจนกว่าจะมีตัวว่าง
  waitForConnections: true,
  connectionLimit: 10,
  // 0 หมายถึงไม่จำกัดจำนวน request ที่รอ connection ในคิว
  queueLimit: 0,
});

// ทุก route และ service import pool ตัวเดียวกัน เพื่อใช้ชุด connection ร่วมกันทั้งแอป
module.exports = pool;
