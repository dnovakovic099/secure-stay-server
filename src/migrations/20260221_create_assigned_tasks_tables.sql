-- Create task_columns table
CREATE TABLE task_columns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    options JSON DEFAULT NULL,
    isDefault TINYINT(1) NOT NULL DEFAULT 0,
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

-- Create assigned_tasks table
CREATE TABLE assigned_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT DEFAULT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
    taskType VARCHAR(100) DEFAULT NULL,
    assignee_id INT DEFAULT NULL,
    dueDate DATETIME DEFAULT NULL,
    isRecurring TINYINT(1) NOT NULL DEFAULT 0,
    recurringPattern JSON DEFAULT NULL,
    customColumnValues JSON DEFAULT NULL,
    created_by INT DEFAULT NULL,
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_assigned_task_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_assigned_task_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Create assigned_task_updates table
CREATE TABLE assigned_task_updates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    user_id INT NOT NULL,
    content TEXT NOT NULL,
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_update_task FOREIGN KEY (task_id) REFERENCES assigned_tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_update_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
