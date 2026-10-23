const fs = require("fs");
const path = require("path");
const pool = require("./db");

// ใช้ connection เดียวตลอดการรัน และจำว่ารันไฟล์ migration ใดไปแล้ว
async function migrate() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    // ชื่อไฟล์ขึ้นต้นด้วยเลข เพื่อให้ migration ทำงานตามลำดับที่แน่นอน
    const directory = path.join(__dirname, "migrations");
    const files = fs.readdirSync(directory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    for (const file of files) {
      const [existing] = await connection.query("SELECT version FROM schema_migrations WHERE version = ?", [file]);
      if (existing.length) {
        console.log(`Already applied: ${file}`);
        continue;
      }
      // ไฟล์ SQL ของโปรเจกต์นี้มีคำสั่งธรรมดาที่คั่นด้วย semicolon
      const statements = fs.readFileSync(path.join(directory, file), "utf8")
        .split(";").map((statement) => statement.trim()).filter(Boolean);
      for (const statement of statements) await connection.query(statement);
      await connection.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
      console.log(`Applied: ${file}`);
    }
  } finally {
    // คืน connection และปิด pool แม้ migration จะเกิดข้อผิดพลาด
    connection.release();
    await pool.end();
  }
}

// แสดงสาเหตุและตั้ง exit code เพื่อให้คำสั่ง npm แจ้งว่ารันไม่สำเร็จ
migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
