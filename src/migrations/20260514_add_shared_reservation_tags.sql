ALTER TABLE reservation_info
  ADD COLUMN tags TEXT NULL;

CREATE TABLE IF NOT EXISTS reservation_tag_settings (
  id INT NOT NULL PRIMARY KEY,
  tag_colors LONGTEXT NULL,
  tag_order LONGTEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO reservation_tag_settings (id, tag_colors, tag_order)
VALUES (1, '{}', '[]');
