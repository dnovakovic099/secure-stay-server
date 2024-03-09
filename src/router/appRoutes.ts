import { Router } from 'express';
import deviceRoutes from './deviceRoutes';
import messagingRoutes from './messagingRoutes';
import connectedAccountRoutes from './ConnectedAccountRoutes';

const router = Router();

router.use('/device', deviceRoutes);
router.use('/messaging', messagingRoutes);
router.use('/account', connectedAccountRoutes);

export default router

