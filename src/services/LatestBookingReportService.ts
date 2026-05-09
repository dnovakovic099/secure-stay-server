import { IsNull, In } from "typeorm";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { appDatabase } from "../utils/database.util";
import sendEmail from "../utils/sendEmai";
import logger from "../utils/logger.utils";
import { format } from "date-fns";

interface ListingWithLatestBooking {
    listing: Listing;
    latestReservation: ReservationInfoEntity | null;
}

export class LatestBookingReportService {
    private listingRepo = appDatabase.getRepository(Listing);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);

    private recipients = [
        "admin@luxurylodgingpm.com",
        "ferdinand@luxurylodgingpm.com",
    ];

    private validStatuses = ["new", "accepted", "modified", "ownerStay", "moved"];

    async sendReport(): Promise<void> {
        try {
            logger.info('[LatestBookingReportService] Fetching latest booking per listing...');

            const allListings = await this.listingRepo.find({
                where: { deletedAt: IsNull() }
            });

            logger.info(`[LatestBookingReportService] Found ${allListings.length} active listings.`);

            const rows: ListingWithLatestBooking[] = [];

            for (const listing of allListings) {
                const latest = await this.reservationRepo.findOne({
                    where: {
                        listingMapId: listing.id,
                        status: In(this.validStatuses)
                    },
                    order: { reservationDate: 'DESC' }
                });

                rows.push({ listing, latestReservation: latest ?? null });
            }

            await this.sendReportEmail(rows);
            logger.info(`[LatestBookingReportService] Report sent for ${rows.length} listing(s).`);

        } catch (error) {
            logger.error(`[LatestBookingReportService] Error sending report: ${error.message}`);
            throw error;
        }
    }

    private async sendReportEmail(rows: ListingWithLatestBooking[]): Promise<void> {
        const reportDate = format(new Date(), 'MMM d, yyyy');
        const subject = `Latest Booking Report — All Listings (${reportDate})`;

        const formatDate = (value: string | Date | null | undefined): string => {
            if (!value) return '—';
            try {
                return format(new Date(value as string), 'MMM d, yyyy');
            } catch {
                return String(value);
            }
        };

        const formatCurrency = (value: number | null | undefined): string => {
            if (value == null) return '—';
            return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        const statusBadge = (status: string | null | undefined): string => {
            if (!status) return '<span style="color:#999;">—</span>';
            const colors: Record<string, string> = {
                new:       '#2563eb',
                accepted:  '#16a34a',
                modified:  '#d97706',
                ownerStay: '#7c3aed',
                moved:     '#0891b2',
            };
            const bg = colors[status] ?? '#6b7280';
            return `<span style="background:${bg};color:#fff;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;white-space:nowrap;">${status}</span>`;
        };

        const tableRows = rows.map(({ listing, latestReservation: r }, i) => {
            const rowBg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
            return `
            <tr style="background-color:${rowBg};">
                <td style="border-bottom:1px solid #e5e7eb;padding:10px 12px;color:#374151;font-weight:600;">${listing.id}</td>
                <td style="border-bottom:1px solid #e5e7eb;padding:10px 12px;color:#111827;font-weight:500;">${listing.internalListingName || '—'}</td>
                <td style="border-bottom:1px solid #e5e7eb;padding:10px 12px;color:#374151;">${r ? formatDate(r.reservationDate) : '<span style="color:#ef4444;font-weight:500;">Never</span>'}</td>
                <td style="border-bottom:1px solid #e5e7eb;padding:10px 12px;color:#374151;">${r?.guestName || '—'}</td>
                <td style="border-bottom:1px solid #e5e7eb;padding:10px 12px;color:#374151;">${r ? formatDate(r.arrivalDate) : '—'}</td>
                <td style="border-bottom:1px solid #e5e7eb;padding:10px 12px;color:#374151;">${r ? formatDate(r.departureDate) : '—'}</td>
                <td style="border-bottom:1px solid #e5e7eb;padding:10px 12px;">${statusBadge(r?.status)}</td>
                <td style="border-bottom:1px solid #e5e7eb;padding:10px 12px;color:#374151;">${r?.channelName || '—'}</td>
                <td style="border-bottom:1px solid #e5e7eb;padding:10px 12px;color:#374151;text-align:right;">${formatCurrency(r ? Number(r.totalPrice) : null)}</td>
                <td style="border-bottom:1px solid #e5e7eb;padding:10px 12px;color:#16a34a;font-weight:600;text-align:right;">${formatCurrency(r?.owner_revenue)}</td>
            </tr>`;
        }).join('');

        const thStyle = 'padding:10px 12px;text-align:left;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap;';
        const thStyleRight = thStyle.replace('text-align:left', 'text-align:right');

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:960px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:32px 40px;">
      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Latest Booking Report</h1>
      <p style="margin:6px 0 0;color:#bfdbfe;font-size:14px;">Most recent reservation per active listing &mdash; ${reportDate}</p>
    </div>

    <!-- Summary bar -->
    <div style="background:#f8fafc;border-bottom:1px solid #e5e7eb;padding:16px 40px;display:flex;">
      <span style="font-size:14px;color:#6b7280;">Total listings: <strong style="color:#111827;">${rows.length}</strong></span>
      <span style="font-size:14px;color:#6b7280;margin-left:24px;">With bookings: <strong style="color:#16a34a;">${rows.filter(r => r.latestReservation).length}</strong></span>
      <span style="font-size:14px;color:#6b7280;margin-left:24px;">No bookings yet: <strong style="color:#ef4444;">${rows.filter(r => !r.latestReservation).length}</strong></span>
    </div>

    <!-- Table -->
    <div style="overflow-x:auto;padding:0 40px 32px;">
      <table style="width:100%;border-collapse:collapse;margin-top:24px;font-size:14px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="${thStyle}">ID</th>
            <th style="${thStyle}">Listing</th>
            <th style="${thStyle}">Booked On</th>
            <th style="${thStyle}">Guest</th>
            <th style="${thStyle}">Arrival</th>
            <th style="${thStyle}">Departure</th>
            <th style="${thStyle}">Status</th>
            <th style="${thStyle}">Channel</th>
            <th style="${thStyleRight}">Total Price</th>
            <th style="${thStyleRight}">Owner Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
      <p style="margin:0;font-size:13px;color:#9ca3af;">Sent automatically every Monday at 6:00 AM EST &bull; <strong style="color:#374151;">Secure Stay</strong></p>
    </div>

  </div>
</body>
</html>`;

        const from = process.env.EMAIL_FROM;
        const to = this.recipients.join(', ');

        if (this.recipients.length > 0) {
            await sendEmail(subject, html, from, to);
            logger.info(`[LatestBookingReportService] Email sent to ${to}`);
        } else {
            logger.warn('[LatestBookingReportService] No recipients configured.');
        }
    }
}
