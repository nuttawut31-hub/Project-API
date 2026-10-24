-- 1. ตัวอย่างสาขาฟิตเนส (ตาราง gyms)
-- พิกัดใช้ตำแหน่งของศูนย์การค้าแต่ละสาขา เพื่อให้การ์ดสภาพอากาศค้นหาจุดใกล้เคียงได้
INSERT INTO gyms (name, address, monthly_fee, phone_number, latitude, longitude) VALUES
('FitLife Siam Paragon', '991 Rama I Rd, Pathum Wan, Bangkok', 1500.00, '02-123-4567', 13.746800, 100.534940),
('FitLife Central Ladprao', '1693 Phahonyothin Rd, Chatuchak, Bangkok', 1200.00, '02-234-5678', 13.816590, 100.560850),
('FitLife Mega Bangna', '39 Bang Na-Trat Rd, Bang Phli, Samut Prakan', 1350.00, '02-345-6789', 13.647110, 100.680530);

-- 2. ลตัวอย่างสมาชิก (ตาราง members)
INSERT INTO members (full_name, email, phone_number, join_date) VALUES
('Somchai Jaidee', 'somchai.j@example.com', '081-111-2222', '2026-01-01'),
('Suda Rakrian', 'suda.r@example.com', '082-333-4444', '2026-01-15'),
('Wichai Khemkhaeng', 'wichai.k@example.com', '083-555-6666', '2026-02-01');

-- 3. ตัวอย่างการสมัครสมาชิก (ตาราง memberships)
-- member_id และ gym_id ต้องเป็นเลข 1, 2 หรือ 3 ตามข้อมูลด้านบน
INSERT INTO memberships (member_id, gym_id, start_date, end_date, status) VALUES
(1, 1, '2026-01-01', '2026-12-31', 'ACTIVE'),
(2, 2, '2026-01-15', '2026-07-15', 'ACTIVE'),
(3, 1, '2026-02-01', '2026-08-01', 'ACTIVE');
