export type LoginCredentials = {
  email: string;
  password: string;
};

export type IListingPageElementChildren = {
  tagName: string;
  className: string;
  id: string;
  text: string;
};
export type IListingPageElementData = {
  parent: string;
  children: IListingPageElementChildren[];
};

export {};
declare global {
  interface AirDnaScrappedDataResponse {
    permission: string;
    load_city: string | null;
    property_details: PropertyDetails;
    compset_amenities: CompsetAmenities;
    comps: Comp[];
    target_ads: Record<string, unknown>;
    combined_market_info: CombinedMarketInfo;
    property_statistics: PropertyStatistics;
    for_sale_property_comps: ForSalePropertyComp[];
  }

  /** Sub-interfaces for the 'payload' section */

  interface PropertyDetails {
    address_city_id: number;
    address_region_id: number[];
    address: string;
    address_lookup: string;
    zipcode: string;
    bedrooms: number;
    bathrooms: number;
    accommodates: number;
    property_value: number | null;
    location: {
      lat: number;
      lng: number;
    };
    currency_symbol: string;
  }

  interface CompsetAmenities {
    percent_with_tv: number;
    percent_with_gym: number;
    percent_with_pool: number;
    percent_with_dryer: number;
    percent_with_aircon: number;
    percent_with_hottub: number;
    percent_with_washer: number;
    percent_with_doorman: number;
    percent_with_heating: number;
    percent_with_kitchen: number;
    percent_with_parking: number;
    percent_with_smoking: number;
    percent_with_cable_tv: number;
    percent_with_elevator: number;
    percent_with_intercom: number;
    percent_with_internet: number;
    percent_with_breakfast: number;
    percent_with_guidebook: number;
    percent_with_pets_allowed: number;
    percent_with_family_friendly: number;
    percent_with_handicap_access: number;
    percent_with_indoor_fireplace: number;
    percent_with_wireless_internet: number;
    percent_with_suitable_for_events: number;
    percent_with_ev_charger: number;
  }

  interface Comp {
    airbnb_property_id: string;
    cover_img: string;
    title: string;
    room_type: string;
    property_type: string;
    reviews: number;
    rating: number;
    distance_meters: number;
    platforms: {
      airbnb_property_id: string | null;
      vrbo_property_id: string | null;
    };
    listing_url: string;
    location: {
      lat: number;
      lng: number;
    };
    bedrooms: number;
    bathrooms: number;
    accommodates: number;
    stats: {
      revenue: {
        ltm: number;
      };
      revenue_potential: {
        ltm: number;
      };
      adr: {
        ltm: number;
      };
      days_available: {
        ltm: number;
      };
      days_reserved: {
        ltm: number;
      };
      occupancy: {
        ltm: number;
      };
    };
  }

  interface CombinedMarketInfo {
    airdna_market_name: string;
    market_type: string;
    market_score: number;
    city_name: string | null;
    country_id: string;
    country_code: string;
    market_id: string;
  }

  /**
   * property_statistics has multiple objects (revenue, cleaning_fee, adr, occupancy, etc.)
   */

  interface PropertyStatistics {
    revenue: RevenueObject;
    cleaning_fee: CleaningFeeObject;
    adr: AdrObject;
    occupancy: OccupancyObject;
    total_comps: number;
    historical_valuation: HistoricalValuation;
    revenue_range: RevenueRange;
  }

  /** Helper interfaces for property_statistics */

  interface RevenueObject {
    ltm: number;
    revenue_years: Record<string, Record<string, number>>;
  }

  interface CleaningFeeObject {
    ltm: number;
    cleaning_fee_years: Record<string, Record<string, number>>;
  }

  interface AdrObject {
    ltm: number;
    adr_years: Record<string, Record<string, number>>;
  }

  interface OccupancyObject {
    ltm: number;
    occupancy_years: Record<string, Record<string, number>>;
  }

  interface HistoricalValuation {
    [year: string]: Record<string, number> | number | undefined;
    mom_perc_chg: number;
    yoy_perc_chg: number;
  }

  interface RevenueRange {
    [year: string]:
      | {
          [month: string]: {
            upper: number;
            lower: number;
          };
        }
      | {
          upper: number;
          lower: number;
        };
  }

  /** For-sale property comps */

  interface ForSalePropertyComp {
    property_details: {
      for_sale_property_id: string;
      sale_or_rent_type: string;
      mls_id: string;
      bedrooms: number;
      bathrooms: number;
      address: string;
      images: string[];
      combined_market_id: string;
      airdna_market_name: string;
      location: {
        lat: number;
        lng: number;
      };
      listing_date: string;
      square_footage: number;
      list_price: number;
      market_type: string | null;
      zoneomics: {
        allows_str: boolean | null;
      };
    };
    estimates: {
      revenue: number;
      adr: number;
      occupancy: number;
      estimated_yield: number;
      total_comps: number;
    };
  }
}
