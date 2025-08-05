import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ContactController } from "../controllers/ContactController";
import { validateCreateContact, validateCreateContactRole, validateCreateLatestUpdate, validateDeleteContact, validateGetContacts, validateUpdateContact, validateUpdateContactRole, validateUpdateLatestUpdate } from "../middleware/validation/contact/contact.validation";

const router = Router();
const contactController = new ContactController();

router.route('/create').post(verifySession, validateCreateContact, contactController.createContact);

router.route('/update').put(verifySession, validateUpdateContact, contactController.updateContact);

router.route('/delete/:id').delete(verifySession, validateDeleteContact, contactController.deleteContact);

router.route('/').get(verifySession, validateGetContacts, contactController.getContacts);


router.route('/roles').post(verifySession, validateCreateContactRole, contactController.createContactRole);
router.route('/roles').put(verifySession, validateUpdateContactRole, contactController.updateContactRole);
router.route('/roles/delete/:id').delete(verifySession, contactController.deleteContactRole);
router.route('/roles').get(verifySession, contactController.getContactRoles);

router.route('/updates').post(verifySession, validateCreateLatestUpdate, contactController.createContactUpdate);
router.route('/updates').put(verifySession, validateUpdateLatestUpdate, contactController.updateContactUpdate);
router.route('/updates/delete/:id').delete(verifySession, contactController.deleteContactUpdate);

export default router;
