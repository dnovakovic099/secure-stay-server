import { ListingController } from "../controllers/ListingController";

export const ListingRoutes = () => {
  const listingController = new ListingController();

  return [
    {
      path: "/listing/getlistings",
      method: "get",
      action: listingController.getListings,
      file: false,
      rawJson: false,
    },
    {
      path: "/listing/getlistings/:listing_id",
      method: "get",
      action: listingController.getListingById,
      file: false,
      rawJson: false,
    },
    {
      path: "/listing/synchostawaylistings",
      method: "get",
      action: listingController.syncHostawayListing,
      file: false,
      rawJson: false,
    },
  ];
};
