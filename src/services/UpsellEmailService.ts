import sendEmail from "../utils/sendEmai";

interface UpsellOrderEmail {
    listing_id: string;
    client_name: string;
    type: string;
    cost: number;
    order_date: string | Date;
    description: string;
    status: string;
}

export async function sendUpsellOrderEmail(order: UpsellOrderEmail) {
    try {
        const orderDate = new Date(order.order_date);
        
        const formattedDate = orderDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

        const formattedAmount = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(order.cost);

        const subject = `New Upsell Order: ${order?.type} for ${order?.client_name}`;
        
        const html = `
            <html>
              <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h2 style="color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px;">New Upsell Order Details</h2>
                    
                    <div style="margin: 20px 0;">
                        <p style="margin: 10px 0;"><strong>Status:</strong> 
                            <span style="padding: 4px 8px; border-radius: 4px; background-color: ${
                                order?.status === 'Approved' ? '#e1f7e1' : 
                                order?.status === 'Pending' ? '#fff3cd' : 
                                order?.status === 'Denied' ? '#ffe1e1' : '#f8f9fa'
                            };">
                                ${order.status}
                            </span>
                        </p>
                        <p style="margin: 10px 0;"><strong>Listing ID:</strong> ${order?.listing_id}</p>
                        <p style="margin: 10px 0;"><strong>Client:</strong> ${order?.client_name}</p>
                        <p style="margin: 10px 0;"><strong>Service:</strong> ${order?.type}</p>
                        <p style="margin: 10px 0;"><strong>Amount:</strong> ${formattedAmount}</p>
                        <p style="margin: 10px 0;"><strong>Date:</strong> ${formattedDate}</p>
                        <p style="margin: 10px 0;"><strong>Description:</strong> ${order?.description || 'No description provided'}</p>
                    </div>

                    <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
                        <p>This is an automated message, please do not reply directly to this email.</p>
                    </div>
                </div>
              </body>
            </html>
        `;

        await sendEmail(
            subject, 
            html, 
            process.env.EMAIL_FROM || 'prasannakumarbaniya@gmail.com',
            process.env.EMAIL_TO || 'admin@luxurylodgingpm.com' 
        );

    } catch (error) {
        console.error('Error sending upsell order email:', error);
        throw new Error('Failed to send email notification');
    }
} 