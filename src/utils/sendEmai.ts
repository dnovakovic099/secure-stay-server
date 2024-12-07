import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendEmail = async (subject: string, html: any, from: string, to: string) => {
    const msg = {
        to: to,
        from: from,
        subject: subject,
        html: html
    };
    try {
        await sgMail.send(msg);
        console.info('Email sent successfully');
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};

export default sendEmail;