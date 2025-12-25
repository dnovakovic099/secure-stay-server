import nodemailer from "nodemailer";
import logger from "./logger.utils";

/**
 * Creates a nodemailer transporter for the Support email account.
 * Uses separate credentials from the main email account to maintain separation of concerns.
 */
const supportTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.SUPPORT_EMAIL,
        pass: process.env.SUPPORT_EMAIL_PASSWORD,
    },
});

/**
 * Send an email using the Support account.
 * This is separate from the main sendEmail utility to use different credentials.
 * 
 * @param to - Recipient email address
 * @param subject - Email subject line
 * @param html - HTML content of the email
 * @returns Promise that resolves when email is sent
 */
export const sendSupportEmail = async (
    to: string,
    subject: string,
    html: string
): Promise<any> => {
    try {
        const info = await supportTransporter.sendMail({
            from: process.env.SUPPORT_EMAIL,
            to,
            subject,
            html,
        });
        logger.info(`Support email sent successfully to ${to}`);
        return info;
    } catch (error) {
        logger.error("Error sending support email", error);
        throw error;
    }
};

export default sendSupportEmail;
