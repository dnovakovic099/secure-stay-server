import  nodemailer from 'nodemailer';
import  fs from "fs";
import ejs from 'ejs';

export class MailClient {
    private transporter: nodemailer.Transporter;
    private templatePath = process.cwd()+"/src"+"/template/";

    constructor() {
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {//boardingpass123
                user: process.env.MAIL_USER,
                pass: process.env.MAIL_PASSWORD,
            },
        });
    }

     sendEmail(to,subject,template,link) {
        const mailOptions: nodemailer.SendMailOptions = {
            from: 'boardingpassdev@gmail.com',
            to,
            subject,
            html: ejs.render(this.processHTMLFile(this.templatePath+template), {link:`${process.env.FRONTEND_URL + link}`})
        };

        this.transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email:', error.message);
            } else {
                console.log('Email sent successfully:', info.response);
            }
        });
    }


       processHTMLFile(filePath: string) {
        try {
            return fs.readFileSync(filePath,'utf8');

        } catch (err) {
            console.error(`Error reading HTML file: ${err}`);
            return null;
        }
    }


}



