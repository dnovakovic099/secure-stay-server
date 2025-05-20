import sgMail from "@sendgrid/mail";
import logger from "./logger.utils";
import nodemailer from "nodemailer";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// const sendEmail = async (subject: string, html: any, from: string, to: string) => {
//     const msg = {
//         to: to,
//         from: from,
//         subject: subject,
//         html: html
//     };
//     try {
//         await sgMail.send(msg);
//         console.info('Email sent successfully');
//     } catch (error) {
//         console.error('Error sending email:', error);
//     }
// };

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_FROM,
        pass: "hjtp sial fgez mmoz",
    },
});

const sendEmail = async (subject: string, html: any, from: string, to: string) => {
    try {
        const info = await transporter.sendMail({ from, to, subject, html });
        logger.info("Email sent successfully");
        return info;
    } catch (error) {
        logger.error("Error sending email", error);
    }
};

export default sendEmail;