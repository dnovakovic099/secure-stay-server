/**
 * Preset catalog for the Verified Property Facts layer — the top of the AI's
 * knowledge hierarchy.
 *
 * One slot per fact. This is deliberately a FIXED, WIDE schema instead of
 * free-text KB entries: a slot can't be spammed with duplicates, and every
 * wrong-info audit category from July 2026 maps onto one of these keys
 * (garage fees quoted flat vs per-night, deposit policy per channel, event
 * capacity, sofa beds, address release, min-stay exceptions...).
 *
 * Values are stored as short free text so the team can write "2 spots in the
 * rear lot, $25.75/night, first-come" without fighting a data type.
 */

export interface PropertyFactField {
    key: string;
    label: string;
    group: string;
    /** Shown to staff in the UI as a nudge for what belongs in the slot. */
    hint?: string;
}

export const PROPERTY_FACT_GROUPS = [
    "Arrival & Access",
    "Parking & Transport",
    "Fees & Deposits",
    "Capacity & Events",
    "Sleeping & Rooms",
    "Amenities",
    "House Rules",
    "Policies & Exceptions",
    "Contacts & Ops",
] as const;

export const PROPERTY_FACT_FIELDS: PropertyFactField[] = [
    // ── Arrival & Access ────────────────────────────────────────────────
    { key: "check_in_time", label: "Check-in time", group: "Arrival & Access" },
    { key: "check_out_time", label: "Check-out time", group: "Arrival & Access" },
    { key: "early_check_in", label: "Early check-in policy & fee", group: "Arrival & Access", hint: "Fee structure (flat or per hour), earliest possible time, approval process" },
    { key: "late_checkout", label: "Late checkout policy & fee", group: "Arrival & Access", hint: "Fee structure, latest possible time, approval process" },
    { key: "address_release", label: "Address release policy", group: "Arrival & Access", hint: "When the full address / access details are shared with the guest" },
    { key: "access_type", label: "Access type & process", group: "Arrival & Access", hint: "Smart lock / lockbox / front desk; when codes go out. Never the code itself." },
    { key: "luggage_drop", label: "Luggage drop-off", group: "Arrival & Access" },
    { key: "lockout_procedure", label: "Lockout procedure", group: "Arrival & Access" },

    // ── Parking & Transport ─────────────────────────────────────────────
    { key: "parking_spots", label: "Parking spots (number & location)", group: "Parking & Transport", hint: "Exact count and where. E.g. '1 designated spot in rear lot'" },
    { key: "parking_fee", label: "Parking fee", group: "Parking & Transport", hint: "State per-night vs flat explicitly. E.g. '$25.75/night, paid via payment link'" },
    { key: "garage", label: "Garage availability & fee", group: "Parking & Transport", hint: "Whether guests can use it, fee structure, how it's reserved" },
    { key: "street_parking", label: "Street parking", group: "Parking & Transport" },
    { key: "ev_charging", label: "EV charging", group: "Parking & Transport" },
    { key: "location_distances", label: "Key distances", group: "Parking & Transport", hint: "Verified drive times/distances guests ask about" },

    // ── Fees & Deposits ─────────────────────────────────────────────────
    { key: "deposit_airbnb", label: "Security deposit — Airbnb", group: "Fees & Deposits", hint: "'None' is a valid, important answer — the listing text may say otherwise" },
    { key: "deposit_vrbo", label: "Security deposit — Vrbo", group: "Fees & Deposits" },
    { key: "deposit_booking", label: "Security deposit — Booking.com", group: "Fees & Deposits" },
    { key: "deposit_direct", label: "Security deposit — Direct", group: "Fees & Deposits" },
    { key: "cleaning_fee", label: "Cleaning fee", group: "Fees & Deposits" },
    { key: "pet_fee", label: "Pet fee", group: "Fees & Deposits" },
    { key: "extra_guest_fee", label: "Extra guest fee", group: "Fees & Deposits" },
    { key: "other_fees", label: "Other fees", group: "Fees & Deposits", hint: "Resort fee, hot tub heating, pool heating, firewood..." },

    // ── Capacity & Events ───────────────────────────────────────────────
    { key: "max_guests", label: "Max overnight guests", group: "Capacity & Events" },
    { key: "max_event_guests", label: "Max event/daytime guests", group: "Capacity & Events" },
    { key: "event_policy", label: "Events & parties policy", group: "Capacity & Events", hint: "Allowed? Fee? Approval process, restrictions (DJ, music, end time)" },
    { key: "visitor_policy", label: "Visitor policy", group: "Capacity & Events", hint: "Daytime visitors allowed? Registered? Counted toward capacity?" },

    // ── Sleeping & Rooms ────────────────────────────────────────────────
    { key: "beds_inventory", label: "Beds inventory", group: "Sleeping & Rooms", hint: "Exact list: '4 queens + twin trundle in master'" },
    { key: "sofa_bed", label: "Sofa bed", group: "Sleeping & Rooms", hint: "Does any sofa convert? Which room?" },
    { key: "extra_bedding", label: "Extra bedding / air mattresses", group: "Sleeping & Rooms" },
    { key: "crib_highchair", label: "Crib / high chair", group: "Sleeping & Rooms" },

    // ── Amenities ───────────────────────────────────────────────────────
    { key: "pool", label: "Pool (hours, heating, fee)", group: "Amenities" },
    { key: "pool_heating", label: "Pool heating policy & fee", group: "Amenities", hint: "Availability, fee structure, timing, approval process, and any seasonal restrictions" },
    { key: "hot_tub", label: "Hot tub", group: "Amenities" },
    { key: "ac_heating", label: "A/C & heating", group: "Amenities", hint: "Zones, thermostat locations, known quirks (e.g. single thermostat in basement)" },
    { key: "washer_dryer", label: "Washer / dryer", group: "Amenities" },
    { key: "kitchen", label: "Kitchen notes", group: "Amenities" },
    { key: "grill", label: "Grill / BBQ", group: "Amenities" },
    { key: "tv_streaming", label: "TV / streaming", group: "Amenities" },
    { key: "wifi_notes", label: "WiFi notes", group: "Amenities", hint: "Speed, coverage quirks. Never the password — that flows separately." },

    // ── House Rules ─────────────────────────────────────────────────────
    { key: "pets_allowed", label: "Pets allowed", group: "House Rules", hint: "Yes/no, size/breed limits, and the fee reference" },
    { key: "smoking", label: "Smoking policy", group: "House Rules" },
    { key: "quiet_hours", label: "Quiet hours", group: "House Rules" },
    { key: "trash", label: "Trash schedule & instructions", group: "House Rules" },

    // ── Policies & Exceptions ───────────────────────────────────────────
    { key: "cancellation_policy", label: "Cancellation policy", group: "Policies & Exceptions" },
    { key: "min_stay_exceptions", label: "Min-stay exception policy", group: "Policies & Exceptions", hint: "Can the team approve shorter stays? Who decides?" },
    { key: "date_change_policy", label: "Date change policy", group: "Policies & Exceptions" },
    { key: "refund_policy", label: "Refund handling", group: "Policies & Exceptions", hint: "The standing rule, not one-off decisions" },

    // ── Contacts & Ops ──────────────────────────────────────────────────
    { key: "receipts_email", label: "Receipts / documents email", group: "Contacts & Ops" },
    { key: "identity_disclosure", label: "How we identify ourselves", group: "Contacts & Ops", hint: "E.g. 'We are the property management team; host name on the platform is X'" },
    { key: "special_notes", label: "Special notes for AI", group: "Contacts & Ops", hint: "Anything else the AI must always know about this property" },
];

export const PROPERTY_FACT_FIELD_KEYS = new Set(PROPERTY_FACT_FIELDS.map((f) => f.key));

export function factFieldLabel(key: string): string {
    return PROPERTY_FACT_FIELDS.find((f) => f.key === key)?.label || key;
}
