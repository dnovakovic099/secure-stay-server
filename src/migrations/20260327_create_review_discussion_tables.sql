CREATE TABLE IF NOT EXISTS review_discussion_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    review_id VARCHAR(255) NOT NULL,
    parent_message_id INT NULL,
    source_type VARCHAR(20) NOT NULL DEFAULT 'note',
    author_id VARCHAR(100) NULL,
    author_name VARCHAR(255) NOT NULL,
    author_avatar VARCHAR(500) NULL,
    content TEXT NOT NULL,
    mentions JSON NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_review_discussion_review (review_id),
    INDEX idx_review_discussion_parent (parent_message_id),
    CONSTRAINT fk_review_discussion_parent
        FOREIGN KEY (parent_message_id) REFERENCES review_discussion_messages(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS review_discussion_reactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message_id INT NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    reaction VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_review_discussion_reaction_message (message_id),
    UNIQUE KEY uniq_review_discussion_reaction_user (message_id, user_id, reaction),
    CONSTRAINT fk_review_discussion_reaction_message
        FOREIGN KEY (message_id) REFERENCES review_discussion_messages(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
