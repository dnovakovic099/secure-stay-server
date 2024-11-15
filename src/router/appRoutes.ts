import { Router } from 'express';
import deviceRoutes from './deviceRoutes';
import messagingRoutes from './messagingRoutes';
import connectedAccountRoutes from './ConnectedAccountRoutes';
import subscriptionRoutes from './userSubscriptionRoutes';
import usersRoutes from "./usersRoutes";
import listingRoutes from "./listingRoutes";
import accountingRoutes from "./accountingRoutes";
import categoryRoutes from "./categoryRoutes";
import fileRoutes from './fileRoutes';
import reservationRoutes from "./reservationRoutes";

const router = Router();

router.use('/device', deviceRoutes);
router.use('/messaging', messagingRoutes);
router.use('/account', connectedAccountRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/users', usersRoutes)
router.use('/listing', listingRoutes)
router.use('/accounting', accountingRoutes);
router.use('/category', categoryRoutes);
router.use(fileRoutes);
router.use('/reservation', reservationRoutes);

export default router

