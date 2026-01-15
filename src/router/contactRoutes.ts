import { Router } from "express";
import verifySession from "../middleware/verifySession";
import { ContactController } from "../controllers/ContactController";
import { validateCreateContact, validateCreateContactRole, validateCreateLatestUpdate, validateDeleteContact, validateGetContacts, validateUpdateContact, validateUpdateContactRole, validateUpdateLatestUpdate, validateBulkUpdateContacts } from "../middleware/validation/contact/contact.validation";

const router = Router();
const contactController = new ContactController();

router.route('/create').post(verifySession, validateCreateContact, contactController.createContact);

router.route('/update').put(verifySession, validateUpdateContact, contactController.updateContact);

router.route('/bulk-update').put(verifySession, validateBulkUpdateContacts, contactController.bulkUpdateContacts);

router.route('/delete/:id').delete(verifySession, validateDeleteContact, contactController.deleteContact);

router.route('/').get(verifySession, validateGetContacts, contactController.getContacts);

router.route('/get-contact-list').get(verifySession, contactController.getContactList);


router.route('/roles').post(verifySession, validateCreateContactRole, contactController.createContactRole);
router.route('/roles').put(verifySession, validateUpdateContactRole, contactController.updateContactRole);
router.route('/roles/delete/:id').delete(verifySession, contactController.deleteContactRole);
router.route('/roles').get(verifySession, contactController.getContactRoles);

router.route('/updates').post(verifySession, validateCreateLatestUpdate, contactController.createContactUpdate);
router.route('/updates').put(verifySession, validateUpdateLatestUpdate, contactController.updateContactUpdate);
router.route('/updates/delete/:id').delete(verifySession, contactController.deleteContactUpdate);

// Cleaner-specific routes
router.route('/cleaners/:listingId').get(verifySession, contactController.getCleanersByListing);
router.route('/primary-cleaner/:listingId').get(verifySession, contactController.getPrimaryCleanerForListing);

export default router;
