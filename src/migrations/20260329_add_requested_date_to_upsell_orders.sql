ALTER TABLE upsell_orders
  ADD COLUMN requested_date DATE NULL AFTER order_date;
