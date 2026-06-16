import { Router } from "express";
import { VendorProfileController } from "../controllers/VendorProfileController";
import verifySession from "../middleware/verifySession";

const router = Router();
const controller = new VendorProfileController();

router.route("/").get(verifySession, controller.getVendorProfiles);
router.route("/").post(verifySession, controller.createVendorProfile);
router.route("/active-cleaners").get(verifySession, controller.getActiveCleanerAssignments);
router.route("/listing/:listingId/cleaning-managed-by").put(verifySession, controller.updateListingCleanerManagedBy);
router.route("/:id").get(verifySession, controller.getVendorProfile);
router.route("/:id").put(verifySession, controller.updateVendorProfile);
router.route("/:id").delete(verifySession, controller.deleteVendorProfile);

router.route("/:vendorProfileId/assignments").post(verifySession, controller.createAssignment);
router.route("/assignments/bulk-update").put(verifySession, controller.bulkUpdateAssignments);
router.route("/assignments/:id").put(verifySession, controller.updateAssignment);
router.route("/assignments/:id").delete(verifySession, controller.deleteAssignment);

export default router;
