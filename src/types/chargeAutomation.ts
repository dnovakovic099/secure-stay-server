export interface CAUpsellOrder {
    listing_id: string;
    price: number;
    created_at: string;
    client_name: string;
    property_owner: string;
    service_type: string;
    description: string;
}

export interface UpsellOrderDetails {
    amount: number;
    persons: number;
    num_nights: number;
    qty: number;
    user_name: string;
}

export interface UpsellPurchasedItem {
    pms_booking_id: string;
    id: number;
    title: string;
    internal_name: string;
    note: string;
    charge_ref_no: string;
    client_approval_status: string;
    is_client_approval_required: boolean | null;
    declined_reason: string;
    currency_symbol: string;
    meta: any;
    upsell_price_details: any;
    order_details: UpsellOrderDetails;
    due_date: string;
    upsell_thumbnail: string;
    upsell_images: any;
}

export interface UpsellPurchasedResponse {
    status: string;
    status_code: number;
    type: string;
    event: string;
    data: UpsellPurchasedItem | UpsellPurchasedItem[];
} 