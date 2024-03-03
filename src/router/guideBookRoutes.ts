import { GuideBookController } from "../controllers/GuideBookController";
import { Router } from "express";
// import { multerUpload } from "../utils/multer.utils";

export const GuideBookRoutes = () => {
  // const router = Router();
  const guideBookController = new GuideBookController();
  // const upload = multerUpload("guideimage");

  return [
    {
      path: "/guides/addGuides",
      method: "post",
      action: guideBookController.PostGuideBook,
      file: true,
      rawJson: false,
    },
    {
      path: "/guides/updateGuides/:id",
      method: "put",
      action: guideBookController.UpdateGuideBook,
      file: true,
      rawJson: false,
    },

    {
      path: "/guides/DeleteGuides/:id",
      method: "delete",
      action: guideBookController.DeleteGuideBook,
      file: false,
      rawJson: false,
    },
  ];
};

// {
//   path: "/listing/getlistings/:listing_id",
//   method: "get",
//   action: listingController.getListingById,
//   file: false,
//   rawJson: false,
// },
// {
//   path: "/listing/synchostawaylistings",
//   method: "get",
//   action: listingController.syncHostawayListing,
//   file: false,
//   rawJson: false,
// },
