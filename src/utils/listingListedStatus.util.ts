export const UNLISTED_LISTING_MARKER = "🔻";

const getStringValue = (value: unknown) => String(value ?? "").trim();

const getObjectCandidates = (...values: any[]): any[] =>
  values.flatMap((value) => {
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
    return value && typeof value === "object" ? [value] : [];
  });

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
  const nestedObjects = getObjectCandidates(listing?.integration, listing?.integrations, listing?.channel, listing?.channels);
  const candidates = [
    listing?.integration_id,
    listing?.integrationId,
    listing?.channel_account_id,
    listing?.channelAccountId,
    listing?.integration?.id,
    listing?.channel?.integration_id,
    listing?.channel?.integrationId,
    listing?.channels?.integration_id,
    listing?.channels?.integrationId,
    listing?.integration?.integration_id,
    ...nestedObjects.flatMap((item) => [
      item?.id,
      item?.integration_id,
      item?.integrationId,
      item?.channel_account_id,
      item?.channelAccountId,
    ]),
  ];

  return Array.from(new Set(candidates
    .map((value) => getStringValue(value))
    .filter(Boolean)));
};

const getHostifyListingIds = (listing: any): string[] => {
  const nestedObjects = getObjectCandidates(listing?.listing, listing?.property, listing?.channel, listing?.channels);
  const candidates = [
    listing?.id,
    listing?.listing_id,
    listing?.listingId,
    listing?.property_id,
    listing?.propertyId,
    listing?.channel_listing_id,
    listing?.channelListingId,
    listing?.channel_property_id,
    listing?.channelPropertyId,
    listing?.external_listing_id,
    listing?.externalListingId,
    listing?.external_id,
    listing?.externalId,
    listing?.externalPropertyId,
    listing?.room_id,
    listing?.roomId,
    listing?.airbnb_id,
    listing?.airbnbId,
    ...nestedObjects.flatMap((item) => [
      item?.id,
      item?.listing_id,
      item?.listingId,
      item?.property_id,
      item?.propertyId,
      item?.channel_listing_id,
      item?.channelListingId,
      item?.channel_property_id,
      item?.channelPropertyId,
      item?.external_listing_id,
      item?.externalListingId,
      item?.external_id,
      item?.externalId,
      item?.externalPropertyId,
      item?.room_id,
      item?.roomId,
      item?.airbnb_id,
      item?.airbnbId,
    ]),
  ];

  return Array.from(new Set(candidates
    .map((value) => getStringValue(value))
    .filter(Boolean)));
};

const getHostifyListingNames = (listing: any): string[] => {
  const nestedObjects = getObjectCandidates(listing?.integration, listing?.integrations);
  const candidates = [
    listing?.integration_name,
    listing?.integrationName,
    listing?.integration_nickname,
    listing?.integrationNickname,
    listing?.integration?.name,
    listing?.integration?.nickname,
    listing?.nickname,
    listing?.name,
    ...nestedObjects.flatMap((item) => [
      item?.integration_name,
      item?.integrationName,
      item?.integration_nickname,
      item?.integrationNickname,
      item?.nickname,
      item?.full_name,
      item?.fullName,
      item?.user,
      item?.name,
    ]),
  ];

  return Array.from(new Set(candidates
    .map((value) => getStringValue(value).toLowerCase())
    .filter(Boolean)));
};

export const findMatchingHostifyChildListing = (
  childListings: any[],
  reservation: {
    externalPropertyId?: string | number | null;
    integration_nickname?: string | null;
    integration?: string | null;
    source?: string | null;
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

  const integrationNames = [
    reservation.integration_nickname,
    reservation.integration,
    reservation.source,
  ].map((value) => getStringValue(value).toLowerCase()).filter(Boolean);
  for (const integrationName of integrationNames) {
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
        listing?.channel?.channel_name,
        listing?.channels?.name,
        listing?.channels?.channel_name,
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
