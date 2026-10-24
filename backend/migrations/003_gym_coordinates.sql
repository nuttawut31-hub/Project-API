-- พิกัดเป็น nullable เพื่อรักษาสาขาเดิมไว้จนกว่าผู้ดูแลจะระบุตำแหน่งจริง
ALTER TABLE gyms
    ADD COLUMN latitude DECIMAL(9, 6) NULL,
    ADD COLUMN longitude DECIMAL(9, 6) NULL;
