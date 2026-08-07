UPDATE upsell_orders
SET requested_date = COALESCE(requested_date, order_date),
    order_date = NULL
WHERE order_date IS NOT NULL
  AND COALESCE(TRIM(status), '') <> 'Paid';
