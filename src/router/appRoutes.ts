import { Router } from "express";
import deviceRoutes from "./deviceRoutes";
import messagingRoutes from "./messagingRoutes";
import connectedAccountRoutes from "./ConnectedAccountRoutes";
import subscriptionRoutes from "./userSubscriptionRoutes";
import usersRoutes from "./usersRoutes";
import listingRoutes from "./listingRoutes";
import accountingRoutes from "./accountingRoutes";
import categoryRoutes from "./categoryRoutes";
import fileRoutes from "./fileRoutes";
import reservationRoutes from "./reservationRoutes";
import authRoutes from "./authRoutes";
import salesRoutes from "./salesRoutes";
import upsellRoutes from "./upsellOrdersRoutes";
import reviewRoutes from "./reviewRoutes";
import reservationDetailRoutes from "./reservationDetailRoutes";
import webhookRoutes from "./webhookRoutes";
import issueRoutes from "./issuesRoutes";
const router = Router();

router.use('/device', deviceRoutes);
router.use('/messaging', messagingRoutes);
router.use('/account', connectedAccountRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/users', usersRoutes)
router.use('/listing', listingRoutes)
router.use('/accounting', accountingRoutes);
router.use('/upsell', upsellRoutes);
router.use('/issues', issueRoutes);
router.use('/category', categoryRoutes);
router.use(fileRoutes);
router.use("/reservation", reservationRoutes);
router.use("/auth", authRoutes);
router.use("/sales", salesRoutes);
router.use("/review", reviewRoutes)
router.use("/reservation-detail", reservationDetailRoutes);
router.use('/webhook', webhookRoutes);

export default router;
