-- Create employee_schedules table
CREATE TABLE IF NOT EXISTS employee_schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    `date` DATE NOT NULL,
    shift_start TIME NOT NULL,
    shift_end TIME NOT NULL,
    break_duration INT NULL,
    shift_type ENUM('Regular', 'Off', 'Holiday') NOT NULL DEFAULT 'Regular',
    notes TEXT NULL,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurring_day_of_week TINYINT NULL,
    created_by VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE INDEX idx_schedule_employee_date (employee_id, `date`),
    INDEX idx_schedule_date (`date`),
    INDEX idx_schedule_shift_type (shift_type)
);
