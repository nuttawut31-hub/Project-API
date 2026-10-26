// นำไลบรารีที่จำเป็นมาใช้: express สำหรับจัดการ request, pool สำหรับเชื่อมต่อฐานข้อมูล
const express = require('express');
const pool = require('./db'); // นำเข้า pool ตัวที่เราสร้างใน db.js

// กำหนดพอร์ตที่จะให้ API ทำงาน และสร้าง Express app
const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Gym Membership Management API');
});

// GET /api/gyms
app.get('/api/gyms', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM gyms');
    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
