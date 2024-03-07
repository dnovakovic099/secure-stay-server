import { Router } from 'express';
import deviceRoutes from './deviceRoutes';
import messagingRoutes from './messagingRoutes';

const router = Router();

router.use('/device', deviceRoutes);
router.use('/messaging', messagingRoutes);

export default router

