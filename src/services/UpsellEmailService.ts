import sendEmail from "../utils/sendEmai";

interface UpsellOrderEmail {
    listing_id: string;
    client_name: string;
    type: string;
    cost: number;
    order_date: Date;
    description: string;
}

export async function sendUpsellOrderEmail(order: UpsellOrderEmail) {
    const subject = `New Upsell Order Received`;
    const html = `
        <html>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
            <h2>New Upsell Order Details:</h2>
            <p>Listing ID: ${order.listing_id}</p>
            <p>Client: ${order.client_name}</p>
            <p>Service: ${order.type}</p>
            <p>Amount: $${order.cost}</p>
            <p>Date: ${order.order_date}</p>
            <p>Description: ${order.description}</p>
          </body>
        </html>
    `;

    await sendEmail(subject, html, process.env.EMAIL_FROM, process.env.EMAIL_TO);
} 