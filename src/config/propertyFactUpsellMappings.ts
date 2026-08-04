export const PROPERTY_FACT_UPSELL_MAPPINGS = {
  early_check_in: "Early Check-In",
  late_checkout: "Late Check-Out",
  pool_heating: "Pool Heating",
  parking_fee: "Parking",
  garage: "Garage",
} as const;

export type PropertyFactUpsellFieldKey = keyof typeof PROPERTY_FACT_UPSELL_MAPPINGS;
