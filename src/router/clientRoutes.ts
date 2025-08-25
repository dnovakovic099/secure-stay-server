import { Router } from "express";
import { ClientController } from "../controllers/ClientController";
import verifyToken from "../middleware/verifyMobileSession";

const router = Router();
const clientController = new ClientController();

// Apply authentication middleware to all routes
router.use(verifyToken);

// Get all clients with pagination and filters
router.get("/", clientController.getClients.bind(clientController));

// Get clients by IDs
router.get("/by-ids", clientController.getClientsByIds.bind(clientController));

// Get client by ID
router.get("/:id", clientController.getClientById.bind(clientController));

// Create new client
router.post("/", clientController.createClient.bind(clientController));

// Update client
router.put("/:id", clientController.updateClient.bind(clientController));

// Delete client
router.delete("/:id", clientController.deleteClient.bind(clientController));

// Search clients
router.get("/search", clientController.searchClients.bind(clientController));

// Get client statistics
router.get("/stats", clientController.getClientStats.bind(clientController));

// Update client statistics (for booking updates)
router.patch("/:id/stats", clientController.updateClientStats.bind(clientController));

export default router;
