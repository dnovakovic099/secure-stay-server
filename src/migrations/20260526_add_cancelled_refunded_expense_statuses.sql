ALTER TABLE expense
  MODIFY status ENUM('Pending Approval', 'Approved', 'Paid', 'Overdue', 'Cancelled', 'Refunded', 'N/A') NOT NULL DEFAULT 'Pending Approval';
