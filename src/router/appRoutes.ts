import { Router } from 'express';
import deviceRoutes from './deviceRoutes';
import messagingRoutes from './messagingRoutes';
import connectedAccountRoutes from './ConnectedAccountRoutes';
import subscriptionRoutes from './userSubscriptionRoutes';
import usersRoutes from "./usersRoutes";

const router = Router();

router.use('/device', deviceRoutes);
router.use('/messaging', messagingRoutes);
router.use('/account', connectedAccountRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/users', usersRoutes)

export default router

