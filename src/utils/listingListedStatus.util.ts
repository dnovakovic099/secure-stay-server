export const UNLISTED_LISTING_MARKER = "🔻";

const getStringValue = (value: unknown) => String(value ?? "").trim();

export const isUnlistedListingStatus = (value: unknown): boolean => {
  if (value === false) return true;
  if (typeof value === "number") return value === 0;

  const normalized = getStringValue(value).toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "unlisted";
};

export const prefixUnlistedListingMarker = (label: string, isUnlisted: boolean): string => {
  const normalizedLabel = label || "";
  if (!isUnlisted || normalizedLabel.startsWith(UNLISTED_LISTING_MARKER)) return normalizedLabel;
  return `${UNLISTED_LISTING_MARKER} ${normalizedLabel}`;
};

const getHostifyListingIntegrationIds = (listing: any): string[] => {
  const candidates = [
    listing?.integration_id,
    listing?.integrationId,
    listing?.integration?.id,
    listing?.channel?.integration_id,
    listing?.channel?.integrationId,
    listing?.channels?.integration_id,
    listing?.channels?.integrationId,
    listing?.integration?.integration_id,
  ];

  return candidates
    .map((value) => getStringValue(value))
    .filter(Boolean);
};

const getHostifyListingIds = (listing: any): string[] => {
  const candidates = [
    listing?.id,
    listing?.listing_id,
    listing?.listingId,
    listing?.channel_listing_id,
    listing?.channelListingId,
    listing?.external_listing_id,
    listing?.externalListingId,
    listing?.externalPropertyId,
  ];

  return candidates
    .map((value) => getStringValue(value))
    .filter(Boolean);
};

const getHostifyListingNames = (listing: any): string[] => {
  const candidates = [
    listing?.integration_name,
    listing?.integrationName,
    listing?.integration_nickname,
    listing?.integrationNickname,
    listing?.integration?.name,
    listing?.integration?.nickname,
    listing?.nickname,
    listing?.name,
  ];

  return candidates
    .map((value) => getStringValue(value).toLowerCase())
    .filter(Boolean);
};

export const findMatchingHostifyChildListing = (
  childListings: any[],
  reservation: {
    externalPropertyId?: string | number | null;
    integration_nickname?: string | null;
    channelName?: string | null;
  },
): any | null => {
  if (!Array.isArray(childListings) || childListings.length === 0) return null;

  const externalPropertyId = getStringValue(reservation.externalPropertyId);
  if (externalPropertyId) {
    const byExternalProperty = childListings.find((listing) =>
      getHostifyListingIds(listing).includes(externalPropertyId)
    );
    if (byExternalProperty) return byExternalProperty;
  }

  const integrationName = getStringValue(reservation.integration_nickname).toLowerCase();
  if (integrationName) {
    const byIntegrationName = childListings.find((listing) =>
      getHostifyListingNames(listing).some((name) => name === integrationName || name.includes(integrationName) || integrationName.includes(name))
    );
    if (byIntegrationName) return byIntegrationName;
  }

  const channelName = getStringValue(reservation.channelName).toLowerCase();
  if (channelName) {
    const channelMatches = childListings.filter((listing) => {
      const channelCandidates = [
        listing?.channel_name,
        listing?.channelName,
        listing?.channel?.name,
        listing?.source,
      ].map((value) => getStringValue(value).toLowerCase()).filter(Boolean);
      return channelCandidates.some((candidate) => candidate === channelName || candidate.includes(channelName) || channelName.includes(candidate));
    });
    if (channelMatches.length === 1) return channelMatches[0];
  }

  const integrationId = getStringValue((reservation as any).integration_id);
  if (integrationId) {
    const byIntegrationId = childListings.find((listing) =>
      getHostifyListingIntegrationIds(listing).includes(integrationId)
    );
    if (byIntegrationId) return byIntegrationId;
  }

  return null;
};
