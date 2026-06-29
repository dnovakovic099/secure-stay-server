import { Router } from 'express';
import { validateSaveEmailInfoRequest, validateSavePhoneNoInfoRequest, validateSupportMessageRequest, validateUpdatePhoneNoInfoRequest } from '../middleware/validation/messaging.validation';
import { MessagingController } from '../controllers/MessagingController';
import verifyMobileSession from '../middleware/verifyMobileSession';
import verifySession from '../middleware/verifySession';

const router = Router();
const messagingController = new MessagingController();

router.route('/saveemailinfo').post(validateSaveEmailInfoRequest, messagingController.saveEmailInfo);
router.route('/deleteemailinfo/:id').delete(messagingController.deleteEmailInfo);
router.route('/getemaillist').get(messagingController.getEmailList);

router.route('/savephonenoinfo').post(validateSavePhoneNoInfoRequest, messagingController.savePhoneNoInfo);
router.route('/deletephonenoinfo/:id').delete(messagingController.deletePhoneNoInfo);
router.route('/updatephonenoinfo').put(validateUpdatePhoneNoInfoRequest, messagingController.updatePhoneNoInfo);
router.route('/getphonenolist').get(messagingController.getPhoneNoList);

router.route('/supportmessage').post(verifyMobileSession, validateSupportMessageRequest, messagingController.sendSupportMessage);

router.route('/conversation-webhook').post(messagingController.handleConversation);

router.route('/unanswered-messages').get(messagingController.getUnansweredMessages);

router.route('/unanswered-messages/:id').put(messagingController.updateMessageStatus);

router.get('/hostify/threads', verifySession, messagingController.listHostifyThreads);
router.get('/hostify/thread/:threadId', verifySession, messagingController.getHostifyThread);
router.post('/hostify/thread/:threadId/reply', verifySession, messagingController.postHostifyReply);

router.get('/openphone/conversations', verifySession, messagingController.listOpenPhoneConversations);
router.get('/openphone/messages/by-participant', verifySession, messagingController.findOpenPhoneMessagesByParticipant);
router.get('/openphone/conversation/:conversationId/messages', verifySession, messagingController.getOpenPhoneMessages);
router.post('/openphone/conversation/:conversationId/reply', verifySession, messagingController.sendOpenPhoneReply);

router.get('/openphone/calls/by-participant', verifySession, messagingController.listOpenPhoneCalls);
router.get('/openphone/calls/:callId/summary', verifySession, messagingController.getOpenPhoneCallSummary);
router.get('/openphone/calls/:callId/transcript', verifySession, messagingController.getOpenPhoneCallTranscript);
router.get('/openphone/calls/:callId/recordings', verifySession, messagingController.getOpenPhoneCallRecordings);

router.get('/reservation/:reservationId/details', verifySession, messagingController.getGuestReservationDetails);
router.put('/reservation/:reservationId/notes', verifySession, messagingController.updateGuestReservationNotes);
router.put('/reservation/:reservationId/custom-fields/:customFieldId', verifySession, messagingController.updateReservationCustomField);

export default router
