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
import claimRoutes from "./claimsRoutes";
import reservationDetailPreStayAuditRoutes from "./reservationDetailPreStayAuditRoutes";
import reservationDetailPostStayAuditRoutes from "./reservationDetailPostStayAuditRoutes";
import reservationInfoRoutes from "./reservationInfoRoutes";
import ownerInfoRoutes from "./ownerInfoRoutes";
import refundRequestRoutes from "./refundRequestRoutes";
import reportsRoutes from "./reportsRoutes";
import ownerPortalRoutes from "./ownerPortalRoutes";
import taskRoutes from "./tasksRoutes";
import clientTicketRoutes from "./clientTicketRoutes";
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
router.use('/claims', claimRoutes);
router.use('/tasks', taskRoutes);
router.use('/reports', reportsRoutes);
router.use('/category', categoryRoutes);
router.use(fileRoutes);
router.use("/reservation", reservationRoutes);
router.use("/auth", authRoutes);
router.use("/sales", salesRoutes);
router.use("/review", reviewRoutes)
router.use("/reservation-detail", reservationDetailRoutes);
router.use('/webhook', webhookRoutes);
router.use("/reservation-detail-pre-stay-audit", reservationDetailPreStayAuditRoutes);
router.use("/reservation-detail-post-stay-audit", reservationDetailPostStayAuditRoutes);
router.use("/reservation-info", reservationInfoRoutes);
router.use("/owner", ownerInfoRoutes)
router.use('/refund-request', refundRequestRoutes)
router.use('/owner-portal', ownerPortalRoutes)
router.use('/client-ticket', clientTicketRoutes);

export default router;
