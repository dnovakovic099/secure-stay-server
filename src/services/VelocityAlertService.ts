import { Between, LessThanOrEqual, MoreThanOrEqual } from "typeorm";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { appDatabase } from "../utils/database.util";
import sendEmail from "../utils/sendEmai";
import logger from "../utils/logger.utils";
import { subHours, subDays, isAfter } from "date-fns";
import redis from "../utils/redisConnection";

export class VelocityAlertService {
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);

    // Configurable email recipients
    private recipients = [
        "admin@luxurylodgingpm.com",
        "ferdinand@luxurylodgingpm.com",
        "prasannakb440@gmail.com"
    ];

    private validStatuses = ["new", "accepted", "modified", "ownerStay", "moved"];

    private getCooldownKey(propertyName: string): string {
        return `velocity_alert_cooldown:${propertyName.replace(/\s+/g, '_').toLowerCase()}`;
    }

    async checkAndTriggerAlert(reservation: Partial<ReservationInfoEntity>) {
        try {
            if (!reservation.listingName || !reservation.status || !reservation.reservationDate) {
                return;
            }

            if (!this.validStatuses.includes(reservation.status)) {
                return;
            }

            const propertyName = reservation.listingName;
            const cooldownKey = this.getCooldownKey(propertyName);

            // Check cooldown in Redis
            const isOnCooldown = await redis.get(cooldownKey);
            if (isOnCooldown) {
                logger.info(`[VelocityAlertService] Cooldown active for ${propertyName} (Redis). Skipping alert.`);
                return;
            }

            const now = new Date();
            const threshold48H = subHours(now, 48);
            const threshold7D = subDays(now, 7);

            // Fetch all confirmed reservations for this property in the last 7 days
            const recentReservations = await this.reservationRepo.find({
                where: {
                    listingName: propertyName,
                },
                order: { reservationDate: "DESC" }
            });

            // Filter by status and date
            // Note: reservationDate is stored as string in DB
            const confirmedReservations = recentReservations.filter(r => {
                if (!this.validStatuses.includes(r.status)) return false;
                const rDate = new Date(r.reservationDate);
                return isAfter(rDate, threshold7D);
            });

            const count48H = confirmedReservations.filter(r => isAfter(new Date(r.reservationDate), threshold48H)).length;
            const count7D = confirmedReservations.length;

            let trigger = false;
            let reason = "";

            if (count48H >= 3) {
                trigger = true;
                reason = "3 bookings within 48hrs";
            } else if (count7D >= 5) {
                trigger = true;
                reason = "5 bookings within 7 days";
            }

            if (trigger) {
                await this.sendVelocityEmail(propertyName, confirmedReservations, reason);
                await redis.setex(cooldownKey, 24 * 60 * 60, 'true'); // 24 hours cooldown
            }

        } catch (error) {
            logger.error(`[VelocityAlertService] Error checking velocity: ${error.message}`);
        }
    }

    private async sendVelocityEmail(propertyName: string, reservations: ReservationInfoEntity[], reason: string) {
        const subject = `URGENT - HIGH BOOKING VELOCITY FOR ${propertyName.toUpperCase()}`;

        const tableRows = reservations.map(r => `
            <tr>
                <td style="border: 1px solid #ddd; padding: 8px;">${r.guestName}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${r.listingName}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${r.arrivalDate}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${r.departureDate}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${r.status}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${r.totalPrice} ${r.currency || ''}</td>
            </tr>
        `).join("");

        const html = `
            <h2>High Booking Velocity Alert</h2>
            <p><strong>Property:</strong> ${propertyName}</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>Below is the list of recent confirmed reservations for this property:</p>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background-color: #f2f2f2;">
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Guest Name</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Listing Name</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Arrival</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Departure</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Status</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Total Price</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
            <p>Regards,<br>Secure Stay</p>
        `;

        const from = process.env.EMAIL_FROM || "noreply@securestay.ai";
        const to = this.recipients.join(", ");

        if (this.recipients.length > 0) {
            await sendEmail(subject, html, from, to);
            logger.info(`[VelocityAlertService] Alert email sent for ${propertyName}`);
        } else {
            logger.warn(`[VelocityAlertService] No recipients configured for velocity alert.`);
        }
    }
}
