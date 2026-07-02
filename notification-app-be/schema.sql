use notification_system
CREATE TABLE students (
    id          CHAR(36) PRIMARY KEY,
    name        VARCHAR(150) NOT NULL,
    email       VARCHAR(150) NOT NULL UNIQUE,
    rollNo      VARCHAR(20) NOT NULL UNIQUE,
    createdAt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
    id                  CHAR(36) PRIMARY KEY,
    studentId           CHAR(36) NOT NULL,
    notificationType    ENUM('PLACEMENT', 'RESULT', 'EVENT') NOT NULL,
    title               VARCHAR(200) NOT NULL,
    message             TEXT NOT NULL,
    isRead              BOOLEAN NOT NULL DEFAULT FALSE,
    createdAt           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    readAt              TIMESTAMP NULL,
    FOREIGN KEY (studentId) REFERENCES students(id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_student_unread
    ON notifications (studentId, isRead, createdAt DESC);

CREATE INDEX idx_notifications_type_created
    ON notifications (notificationType, createdAt DESC);
    
INSERT INTO students (id, name, email, rollNo)
VALUES (
'11111111-1111-1111-1111-111111111111',
'Student A',
'student@example.edu',
'STU001'
);
INSERT INTO notifications (id, studentId, notificationType, title, message, isRead, createdAt) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'PLACEMENT', 'Placement Update', 'TCS hiring drive results out', false, NOW()),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'RESULT', 'Result Declared', 'Mid-sem result declared', false, NOW() - INTERVAL 2 DAY),
('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'EVENT', 'Tech Fest', 'Fest registration open', true, NOW() - INTERVAL 10 DAY);

SELECT id, notificationType, title, message, createdAt
FROM notifications
WHERE studentId = '11111111-1111-1111-1111-111111111111' AND isRead = false
ORDER BY createdAt DESC
LIMIT 20 OFFSET 0;

UPDATE notifications
SET isRead = true, readAt = NOW()
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND studentId = '11111111-1111-1111-1111-111111111111';

SELECT DISTINCT studentId
FROM notifications
WHERE notificationType = 'PLACEMENT'
  AND createdAt >= NOW() - INTERVAL 7 DAY;
  
EXPLAIN SELECT id, notificationType, title, message, createdAt
FROM notifications
WHERE studentId = '11111111-1111-1111-1111-111111111111' AND isRead = false
ORDER BY createdAt DESC;SHOW TABLES;
