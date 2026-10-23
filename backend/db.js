const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'gym_db',
  // DATE เป็นวันที่ปฏิทิน ไม่มี timezone; คืนเป็น YYYY-MM-DD เพื่อไม่ให้หน้าเว็บเลื่อนวัน
  dateStrings: ['DATE'],
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
