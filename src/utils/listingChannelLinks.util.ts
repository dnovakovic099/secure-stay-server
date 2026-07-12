export type ListingChannelLinkRecord = {
  id?: number | string;
  listingId?: number | string;
  listingMapId?: number | string;
  channel?: string | { name?: string; id?: number | string };
  channel_id?: number | string;
  channelId?: number | string;
  channel_name?: string;
  channelName?: string;
  channel_listing_id?: number | string;
  channelListingId?: number | string;
  integration_name?: string;
  integration?: string;
  name?: string;
  nickname?: string;
};

const CHANNEL_ID_NAMES: Record<string, string> = {
  "1": "Airbnb",
  "2": "Booking.com",
  "3": "Vrbo",
  "4": "Expedia",
  "5": "TripAdvisor",
  "6": "Direct",
  "7": "Google Vacation",
  "79": "Google Vacation",
};

export const getHostifyChildListingUrl = (listingId?: number | string | null) => {
  const normalized = String(listingId ?? "").trim();
  return normalized ? `https://us.hostify.com/listings/view/${normalized}` : "";
};

export const getHostifyPublicListingUrl = (listingId?: number | string | null) => {
  const normalized = String(listingId ?? "").trim();
  return normalized ? `https://escapestays.hostify.club/listing/${normalized}` : "";
};

export const getListingChannelName = (record: ListingChannelLinkRecord = {}) => {
  if (record.channel_name) return String(record.channel_name);
  if (record.channelName) return String(record.channelName);
  if (typeof record.channel === "object" && record.channel?.name) return String(record.channel.name);
  if (typeof record.channel === "string" && record.channel) return record.channel;

  const channelId = String(record.channel_id ?? record.channelId ?? "");
  if (CHANNEL_ID_NAMES[channelId]) return CHANNEL_ID_NAMES[channelId];

  const searchText = `${record.nickname || ""} ${record.name || ""} ${record.integration_name || ""} ${record.integration || ""}`.toLowerCase();
  if (searchText.includes("airbnb")) return "Airbnb";
  if (searchText.includes("vrbo") || searchText.includes("homeaway")) return "Vrbo";
  if (searchText.includes("booking") || searchText.includes("bcom")) return "Booking.com";
  if (searchText.includes("marriott") || searchText.includes("hvmb")) return "Marriott";
  if (searchText.includes("hometogo") || searchText.includes("home to go")) return "HomeToGo";
  if (searchText.includes("google")) return "Google Vacation";
  if (searchText.includes("hostify") || searchText.includes("direct")) return "Hostify";
  return "";
};

export const getListingChannelKey = (record: ListingChannelLinkRecord = {}) => {
  const searchText = `${getListingChannelName(record)} ${record.integration_name || ""} ${record.integration || ""} ${record.name || ""} ${record.nickname || ""}`.toLowerCase();
  if (searchText.includes("airbnb")) return "airbnb";
  if (searchText.includes("vrbo") || searchText.includes("homeaway")) return "vrbo";
  if (searchText.includes("booking") || searchText.includes("bcom")) return "booking";
  if (searchText.includes("marriott") || searchText.includes("hvmb")) return "marriott";
  if (searchText.includes("hometogo") || searchText.includes("home to go")) return "hometogo";
  if (searchText.includes("google")) return "google";
  if (searchText.includes("hostify") || searchText.includes("direct")) return "hostify";
  return "";
};

const getVrboListingId = (channelListingId: string) => {
  const parts = channelListingId.split(".");
  return parts.length >= 3 ? parts[1] : channelListingId;
};

export const getListingChannelUrl = (record: ListingChannelLinkRecord = {}) => {
  const channelKey = getListingChannelKey(record);
  const listingId = record.id ?? record.listingMapId ?? record.listingId;
  const channelListingId = String(record.channel_listing_id ?? record.channelListingId ?? "").trim();

  if (channelKey === "booking" || channelKey === "hometogo") {
    return getHostifyChildListingUrl(listingId);
  }

  if (channelKey === "hostify") {
    return getHostifyPublicListingUrl(listingId) || getHostifyChildListingUrl(listingId);
  }

  if (channelKey === "airbnb" && channelListingId) return `https://www.airbnb.com/rooms/${channelListingId}`;
  if (channelKey === "marriott" && channelListingId) return `https://homes-and-villas.marriott.com/en/properties/${channelListingId}`;
  if (channelKey === "vrbo" && channelListingId) return `https://www.vrbo.com/${getVrboListingId(channelListingId)}`;

  return getHostifyChildListingUrl(listingId);
};
