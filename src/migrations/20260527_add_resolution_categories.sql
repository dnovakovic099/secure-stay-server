CREATE TABLE IF NOT EXISTS resolution_categories (
  id INT NOT NULL AUTO_INCREMENT,
  categoryKey VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  displayOrder INT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_resolution_categories_category_key (categoryKey)
);

INSERT IGNORE INTO resolution_categories (categoryKey, name, displayOrder)
VALUES
  ('claim', 'Claim', 1),
  ('security_deposit', 'Security Deposit', 2),
  ('pet_fee', 'Pet Fee', 3),
  ('extra_cleaning', 'Extra Cleaning', 4),
  ('resolution', 'Resolution', 5),
  ('review_removal', 'Review Removal', 6),
  ('others', 'Others', 7),
  ('dispute', 'Dispute', 8);
