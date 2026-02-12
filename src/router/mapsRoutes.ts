import { Router } from "express";
import { MapsController } from "../controllers/MapsController";
import verifySession from "../middleware/verifySession";
import { validateMapsSearch } from "../middleware/validation/maps/maps.validation";

const router = Router();
const mapsController = new MapsController();

// Get all unique states from city_state_info table
router.route("/states").get(verifySession, mapsController.getStates);

// Get cities for a given state
router.route("/cities").get(verifySession, mapsController.getCities);

// Get listings that can serve as reference properties
router.route("/properties").get(verifySession, mapsController.getListingsForReference);

// Search for properties based on filters
router.route("/search").post(verifySession, validateMapsSearch, mapsController.searchProperties);

// Get distance between two properties
router.route("/distance").get(verifySession, mapsController.getDistance);

export default router;
