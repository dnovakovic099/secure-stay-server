import { Router } from 'express';
import deviceRoutes from './deviceRoutes';

const router = Router();

router.use('/device', deviceRoutes);

export default router

