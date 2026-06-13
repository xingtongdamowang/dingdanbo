CREATE TABLE IF NOT EXISTS records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NULL,
  ticket_type VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT '手动录入',
  amount DECIMAL(10, 2) NOT NULL,
  multiple_count INT UNSIGNED NOT NULL DEFAULT 1,
  stake DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'win', 'lost') NOT NULL DEFAULT 'pending',
  result VARCHAR(255) NOT NULL DEFAULT '待赛果',
  prize DECIMAL(10, 2) NOT NULL DEFAULT 0,
  note TEXT NULL,
  image_path VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_records_code (code),
  KEY idx_records_status_created (status, created_at),
  KEY idx_records_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS record_legs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id BIGINT UNSIGNED NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  league VARCHAR(64) NOT NULL DEFAULT '未分类赛事',
  match_name VARCHAR(128) NOT NULL,
  play VARCHAR(64) NOT NULL,
  pick VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_record_legs_ticket (ticket_id, sort_order),
  CONSTRAINT fk_record_legs_ticket
    FOREIGN KEY (ticket_id) REFERENCES records(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
