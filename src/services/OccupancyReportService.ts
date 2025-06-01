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

    // New helper to format unique blocked notes for Excel
    private formatBlockedNotesForExcel(blockedObjects: { date: string; note: string; }[]): string {
        if (!blockedObjects || blockedObjects.length === 0) return "";

        const notesMap = new Map<string, string[]>(); // Map to store unique notes and their associated dates

        blockedObjects.forEach(item => {
            const note = item.note && item.note.trim() !== '' ? item.note.trim() : 'No specific reason';
            if (!notesMap.has(note)) {
                notesMap.set(note, []);
            }
            notesMap.get(note)!.push(item.date);
        });

        const formattedNotes: string[] = [];
        notesMap.forEach((dates, note) => {
            const dateRanges = this.formatDateRanges(dates);
            formattedNotes.push(`${note} (${dateRanges})`);
        });

        return formattedNotes.join("; "); // Join notes with a semicolon for readability in a single cell
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

        // --- Updated: Added 'Blocked Notes' column ---
        worksheet.columns = [
            { header: 'Property Type', key: 'type', width: 15 },
            { header: 'Listing Name', key: 'listingName', width: 30 },
            { header: 'Period (days)', key: 'period', width: 20 },
            { header: 'Occupancy Rate (%)', key: 'occupancyRate', width: 20 },
            { header: 'Owner Stay (days)', key: 'ownerStayDays', width: 20 },
            { header: 'Blocked (days)', key: 'blockedDays', width: 20 },
            { header: 'Owner Stay Dates', key: 'ownerStayDates', width: 40 },
            { header: 'Blocked Dates', key: 'blockedDates', width: 40 },
            { header: 'Blocked Notes', key: 'blockedNotes', width: 50 } // New column for notes
        ];
        // --- End Updated ---

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
                        const blockedObjects = details.blockedDates || []; // This is the array of objects

                        const blockedDates = blockedObjects.map((item: { date: string; }) => item.date);
                        // --- New: Format blocked notes for Excel ---
                        const blockedNotesFormatted = this.formatBlockedNotesForExcel(blockedObjects);
                        // --- End New ---

                        worksheet.addRow({
                            type: typeLabel,
                            listingName: name,
                            period: `${prefix} ${days}`,
                            occupancyRate: details.occupancyRate || "",
                            ownerStayDays: ownerStay.length,
                            blockedDays: blockedObjects.length,
                            ownerStayDates: this.formatDateRanges(ownerStay),
                            blockedDates: this.formatDateRanges(blockedDates),
                            blockedNotes: blockedNotesFormatted // Add the formatted notes to the row
                        });
                    });
                });
            });
        };

        processListings(data.own, "Own");
        processListings(data.arbitraged, "Arbitraged");
        processListings(data.pmClients, "PM Client");

        const uint8Array = await workbook.xlsx.writeBuffer();
        return Buffer.from(uint8Array);
    }


    public async sendDailyReport(): Promise<void> {
        try {
            const { result, pmClientsLowOccupancy, ownArbitrageLowOccupancy } = await this.occupancyRateService.getOccupancyPercent();
            // const mockData = {
            //     own: [
            //         {
            //             listingName: "Ocean View Villa",
            //             pastRates: {
            //                 "90days": { occupancyRate: 40, ownerStayDates: ["2025-04-01", "2025-04-02"], blockedDates: [{ date: "2025-04-03", note: "Test note" }] },
            //                 "30days": { occupancyRate: 35, ownerStayDates: ["2025-05-01"], blockedDates: [{ date: "2025-05-03", note: "Accidental cancellation of Yvonne Ronceros" }, { date: "2025-05-04", note: "Accidental cancellation of Yvonne Ronceros" }, { date: "2025-05-08", note: "Testing the second note" }] },
            //                 "14days": { occupancyRate: 20, ownerStayDates: [], blockedDates: [{ date: "2025-05-10", note: "" }] },
            //                 "7days": { occupancyRate: 15, ownerStayDates: [], blockedDates: [] }
            //             },
            //             futureRates: {
            //                 "7days": { occupancyRate: 10, ownerStayDates: [], blockedDates: [] },
            //                 "14days": { occupancyRate: 25, ownerStayDates: ["2025-04-01", "2025-04-02"], blockedDates: [] },
            //                 "30days": { occupancyRate: 30, ownerStayDates: ["2025-04-01", "2025-04-02"], blockedDates: [{ date: "2025-04-01", note: "Something went wrong" }] },
            //                 "90days": { occupancyRate: 50, ownerStayDates: [], blockedDates: [] }
            //             }
            //         }
            //     ],
            //     arbitraged: [],
            //     pmClients: []
            // };

            const ownArbitrageHtml = await this.generateEmailHtml(ownArbitrageLowOccupancy);
            const pmClientHtml = await this.generateEmailHtml(pmClientsLowOccupancy);
            const excelBuffer = await this.generateExcelBuffer(result);

            await this.sendOccupancyReportEmail(
                `Owned + Arbitraged Occupancy Rate Report - ${format(new Date(), 'MMMM dd, yyyy')}`,
                ownArbitrageHtml,
                excelBuffer
            );

            await this.sendOccupancyReportEmail(
                `PM Clients Occupancy Rate Report - ${format(new Date(), 'MMMM dd, yyyy')}`,
                pmClientHtml,
                excelBuffer
            );


            logger.info("Daily occupancy report sending process completed.");
        }
        catch (error) {
            logger.error("Error sending daily occupancy report:", error);
        }
    }

    private async sendOccupancyReportEmail(subject: string, html: any, excelBuffer: any) {
        const recipients = [
            "admin@luxurylodgingpm.com",
            "ferdinand@luxurylodgingpm.com",
            // "prasannakb440@gmail.com"
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
                logger.info(`Email sent successfully to ${recipient}`);
            } catch (error) {
                logger.error(`Error sending email to ${recipient}:`, error);
            }
        }
    }
}