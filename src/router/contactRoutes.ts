import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ContactController } from "../controllers/ContactController";
import { validateCreateContact, validateDeleteContact, validateGetContacts, validateUpdateContact } from "../middleware/validation/contact/contact.validation";

const router = Router();
const contactController = new ContactController();

router.route('/create').post(verifySession, validateCreateContact, contactController.createContact);

router.route('/update').put(verifySession, validateUpdateContact, contactController.updateContact);

router.route('/delete/:id').delete(verifySession, validateDeleteContact, contactController.deleteContact);

router.route('/').get(verifySession, validateGetContacts, contactController.getContacts);

export default router;
