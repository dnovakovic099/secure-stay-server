import { OccupancyRateService } from "./OccupancyRateService";
import sendEmail from "../utils/sendEmai";
import ejs from "ejs";
import fs from "fs";
import path from "path";
import logger from "../utils/logger.utils";

export class OccupancyReportService {
    private occupancyRateService: OccupancyRateService;
    private templatePath: string;

    constructor() {
        this.occupancyRateService = new OccupancyRateService();
        this.templatePath = path.join(process.cwd(), "src", "template", "occupancyReport.ejs");
    }

    /**
     * Generate HTML email content using EJS template
     * @param data Occupancy data object with own, arbitraged, pmClients
     */
    private async generateEmailHtml(data: any): Promise<string> {
        try {
            const template = fs.readFileSync(this.templatePath, "utf8");
            return ejs.render(template, { data: data }); // Use 'result' to match EJS variable
        } catch (err) {
            logger.error("Error rendering EJS template:", err);
            throw err;
        }
    }

    /**
     * Fetch occupancy data and send formatted HTML report via email
     */
    public async sendDailyReport(): Promise<void> {
        try {
            // Step 1: Get occupancy data
            const { result, lowOccupancy } = await this.occupancyRateService.getOccupancyRates();
            // const data = {
            //     own: [
            //         {
            //             listingName: "Sunny Apartment Downtown",
            //             pastRates: {
            //                 "7days": { occupancyRate: 70 },
            //                 "14days": { occupancyRate: 72 },
            //                 "30days": {
            //                     occupancyRate: 60,
            //                     ownerStayDates: ["2025-04-01", "2025-04-02", "2025-04-03"],
            //                     blockedDates: ["2025-04-10", "2025-04-11"]
            //                 },
            //                 "90days": { occupancyRate: 75 }
            //             },
            //             futureRates: {
            //                 "7days": { occupancyRate: 68 },
            //                 "14days": { occupancyRate: 62 },
            //                 "30days": {
            //                     occupancyRate: 64,
            //                     ownerStayDates: ["2025-06-10", "2025-06-11", "2025-06-12", "2025-06-13", "2025-06-14"],
            //                     blockedDates: ["2025-06-20", "2025-06-21"]
            //                 },
            //                 "90days": { occupancyRate: 78 }
            //             }
            //         }
            //     ],
            //     arbitraged: [],
            //     pmClients: []
            // };

            // Step 2: Generate email HTML content using EJS
            const html = await this.generateEmailHtml(lowOccupancy);

            // Step 3: Define email details
            const subject = "Daily Occupancy Rate Report";
            const recipients = [
                // "admin@luxurylodgingpm.com",
                // "ferdinand@luxurylodgingpm.com",
                "prasannakb440@gmail.com"
            ];

            // Step 4: Send email to each recipient
            for (const recipient of recipients) {

                await sendEmail(subject, html, process.env.EMAIL_FROM, recipient);
            }

            logger.info("Daily occupancy report sent successfully");
        } catch (error) {
            logger.error("Error sending daily occupancy report:", error);
        }
    }
}
