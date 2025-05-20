import { OccupancyRateService } from "./OccupancyRateService";
import sendEmail from "../utils/sendEmai";
import ejs from "ejs";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import logger from "../utils/logger.utils";
import nodemailer from "nodemailer";
import { format, parseISO, addDays, isSameDay } from "date-fns";

export class OccupancyReportService {
    private occupancyRateService: OccupancyRateService;
    private templatePath: string;

    constructor() {
        this.occupancyRateService = new OccupancyRateService();
        this.templatePath = path.join(process.cwd(), "src", "template", "occupancyReport.ejs");
    }

    private formatDateRanges(dates: string[]): string {
        if (!dates || dates.length === 0) return "";

        const sorted = dates.map(d => parseISO(d)).sort((a, b) => a.getTime() - b.getTime());

        const ranges: string[] = [];
        let start = sorted[0];
        let end = start;

        for (let i = 1; i < sorted.length; i++) {
            const current = sorted[i];
            const nextDay = addDays(end, 1);

            if (isSameDay(current, nextDay)) {
                end = current;
            } else {
                ranges.push(this.formatRange(start, end));
                start = current;
                end = current;
            }
        }

        ranges.push(this.formatRange(start, end));
        return ranges.join(", ");
    }

    private formatRange(start: Date, end: Date): string {
        const sameDay = isSameDay(start, end);
        const sameMonth = start.getMonth() === end.getMonth();

        const formatShort = (date: Date) => format(date, "MMM dd");

        if (sameDay) {
            return formatShort(start);
        }

        if (sameMonth) {
            return `${formatShort(start)} – ${format(end, "dd")}`;
        }

        return `${formatShort(start)} – ${formatShort(end)}`;
    }

    private async generateEmailHtml(data: any): Promise<string> {
        try {
            const template = fs.readFileSync(this.templatePath, "utf8");
            return ejs.render(template, { data });
        } catch (err) {
            logger.error("Error rendering EJS template:", err);
            throw err;
        }
    }

    private async generateExcelBuffer(data: any): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Occupancy Report");

        worksheet.columns = [
            { header: 'Property Type', key: 'type', width: 15 },
            { header: 'Listing Name', key: 'listingName', width: 30 },
            { header: 'Period (days)', key: 'period', width: 20 },
            { header: 'Occupancy Rate (%)', key: 'occupancyRate', width: 20 },
            { header: 'Owner Stay (days)', key: 'ownerStayDays', width: 20 },
            { header: 'Blocked (days)', key: 'blockedDays', width: 20 },
            { header: 'Owner Stay Dates', key: 'ownerStayDates', width: 40 },
            { header: 'Blocked Dates', key: 'blockedDates', width: 40 }
        ];

        worksheet.getRow(1).font = { bold: true };

        const processListings = (listings: any[], typeLabel: string) => {
            listings.forEach(listing => {
                const name = listing.listingName;

                ["pastRates", "futureRates"].forEach(rateType => {
                    const prefix = rateType === "pastRates" ? "Past" : "Future";
                    const rateData = listing[rateType] || {};

                    Object.entries(rateData).forEach(([period, details]: [string, any]) => {
                        const days = period.replace("days", "");
                        const ownerStay = details.ownerStayDates || [];
                        const blocked = details.blockedDates || [];

                        worksheet.addRow({
                            type: typeLabel,
                            listingName: name,
                            period: `${prefix} ${days}`,
                            occupancyRate: details.occupancyRate || "",
                            ownerStayDays: ownerStay.length,
                            blockedDays: blocked.length,
                            ownerStayDates: this.formatDateRanges(ownerStay),
                            blockedDates: this.formatDateRanges(blocked)
                        });

                    });
                });
            });
        };

        processListings(data.own, "Own");
        processListings(data.arbitraged, "Arbitraged");
        processListings(data.pmClients, "PM Client");

        const uint8Array = await workbook.xlsx.writeBuffer();
        return Buffer.from(uint8Array); // ✅ Convert Uint8Array to Node.js Buffer
    }


    public async sendDailyReport(): Promise<void> {
        try {
            const { result, lowOccupancy } = await this.occupancyRateService.getOccupancyPercent();

            const html = await this.generateEmailHtml(lowOccupancy);
            const excelBuffer = await this.generateExcelBuffer(result);

            const subject = `Daily Occupancy Rate Report - ${format(new Date(), 'MMMM dd, yyyy')}`;
            const recipients = [
                "admin@luxurylodgingpm.com",
                "ferdinand@luxurylodgingpm.com"
            ];

            const transporter = nodemailer.createTransport({
                service: "gmail",
                auth: {
                    user: process.env.EMAIL_FROM,
                    pass: "hjtp sial fgez mmoz",
                },
            });

            for (const recipient of recipients) {
                try {
                    await transporter.sendMail({
                        from: process.env.EMAIL_FROM,
                        to: recipient,
                        subject,
                        html,
                        attachments: [
                            {
                                filename: "Occupancy_Report.xlsx",
                                content: excelBuffer,
                                contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            }
                        ]
                    });
                    logger.info("Email sent successfully");
                } catch (error) {
                    logger.error("Error sending email", error);
                }
            }

            logger.info("Daily occupancy report sent successfully");
        } catch (error) {
            logger.error("Error sending daily occupancy report:", error);
        }
    }


}
