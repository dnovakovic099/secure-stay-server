import { Router } from "express";
import { ListingDocumentController } from "../controllers/ListingDocumentController";
import verifySession from "../middleware/verifySession";
import fileUpload from "../utils/upload.util";

const router = Router();
const controller = new ListingDocumentController();

// Upload a document (PDF/DOCX/TXT/MD/RTF/XLSX/CSV) for a listing. The text is
// extracted, chunked, and embedded so the AI assistant can retrieve it.
router.post("/", verifySession, fileUpload("listing-docs").single("file"), controller.upload);

// List documents for a listing.
router.get("/", verifySession, controller.list);

// Delete a document (also removes its embedded chunks).
router.delete("/:id", verifySession, controller.remove);

export default router;
