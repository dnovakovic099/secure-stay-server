import { NextFunction, Request, Response } from "express";
import { IncomeService } from "../services/IncomeService";
import sendEmail from "../utils/sendEmai";

interface CustomRequest extends Request {
    user?: any;
}

export class IncomeController {
    async generateIncomeStatement(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const incomeService = new IncomeService();
            const userId = request.user.id;
            return response.send(await incomeService.generateIncomeStatement(request, userId));
        } catch (error) {
            return next(error);
        }
    }

    async requestRevenueCalculation(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            //send email notification
            const { message } = request.body;
            const { email, name } = request.user;

            const subject = "Revenue calculation request";
            const html = `
                <html>
                  <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); padding: 20px;">
                      <h2 style="color: #007BFF; border-bottom: 2px solid #007BFF; padding-bottom: 10px;">Revenue Calculation Request</h2>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Message:</strong> ${message}
                      </p>
                      <p style="margin: 20px 0; font-size: 16px;">
                        <strong>Requested By:</strong> ${name} (${email})
                      </p>
                      <p style="margin: 30px 0 0; font-size: 14px; color: #777;">Thank you!</p>
                    </div>
                  </body>
                </html>

        `;

            await sendEmail(subject, html, process.env.EMAIL_FROM, "prasannakb440@gmail.com");
            return response.send({ message: "Request sent successfully" });
        } catch (error) {
            return next(error);
        }
    }
}
