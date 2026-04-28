CREATE TABLE IF NOT EXISTS review_reports (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  templateType VARCHAR(64) NOT NULL,
  filters JSON NOT NULL,
  chatHistory JSON NULL,
  linkedAiThreadId VARCHAR(36) NULL,
  currentVersionNumber INT NOT NULL DEFAULT 1,
  createdBy VARCHAR(120) NULL,
  updatedBy VARCHAR(120) NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_review_reports_templateType_updatedAt (templateType, updatedAt)
);

CREATE TABLE IF NOT EXISTS review_report_versions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  reportId VARCHAR(36) NOT NULL,
  versionNumber INT NOT NULL,
  generationType VARCHAR(48) NOT NULL,
  targetSectionKey VARCHAR(64) NULL,
  instruction LONGTEXT NULL,
  document JSON NOT NULL,
  createdBy VARCHAR(120) NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_review_report_versions_reportId_versionNumber (reportId, versionNumber)
);
