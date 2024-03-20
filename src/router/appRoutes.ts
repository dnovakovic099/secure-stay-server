import { Router } from 'express';
import deviceRoutes from './deviceRoutes';
import messagingRoutes from './messagingRoutes';
import connectedAccountRoutes from './ConnectedAccountRoutes';
import subscriptionRoutes from './userSubscriptionRoutes'

const router = Router();

router.use('/device', deviceRoutes);
router.use('/messaging', messagingRoutes);
router.use('/account', connectedAccountRoutes);
router.use('/subscription', subscriptionRoutes);

export default router

