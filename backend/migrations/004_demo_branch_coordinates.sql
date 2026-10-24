-- เติมพิกัดศูนย์การค้าให้สาขาตัวอย่างที่มีอยู่ โดยไม่เขียนทับพิกัดที่ผู้ดูแลกรอกไว้แล้ว
UPDATE gyms
SET latitude = 13.746800, longitude = 100.534940
WHERE name = 'FitLife Siam Paragon' AND latitude IS NULL AND longitude IS NULL;

UPDATE gyms
SET latitude = 13.816590, longitude = 100.560850
WHERE name = 'FitLife Central Ladprao' AND latitude IS NULL AND longitude IS NULL;

UPDATE gyms
SET latitude = 13.647110, longitude = 100.680530
WHERE name = 'FitLife Mega Bangna' AND latitude IS NULL AND longitude IS NULL;

UPDATE gyms
SET latitude = 13.336415, longitude = 100.969349
WHERE name = 'FitLife Central Chonburi' AND latitude IS NULL AND longitude IS NULL;
