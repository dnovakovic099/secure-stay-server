import sendEmail from "../utils/sendEmai";

export async function sendReviewUpdateEmail(reviewDetail: any) {
    try {
        const subject = `Review Update Alert - ID: ${reviewDetail.id}`;
        const oldLog = reviewDetail.oldLog;
        const html = `
<html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px;">Review Update Notification</h2>
            
            <p style="font-size: 16px; color: #555;">A Review has been updated. Here are the details:</p>

            <div style="margin: 20px 0;">
                <p style="margin: 10px 0;"><strong>Guest Name:</strong> ${reviewDetail.review.guestName || 'Not provided'}</p>
                 <p style="margin: 10px 0;"><strong>Listing Title:</strong> ${reviewDetail.review.listingName || 'Not provided'}</p>
                <p style="margin: 10px 0;"><strong>Date of Review Detail:</strong> ${reviewDetail.date || 'Not provided'}</p>

                <p style="margin: 10px 0;"><strong>Previous First Contact Date:</strong> ${oldLog?.firstContactDate || 'Not provided'}</p>
                <p style="margin: 10px 0;"><strong>Updated First Contact Date:</strong> ${reviewDetail.firstContactDate || 'Not provided'}</p>

                <p style="margin: 10px 0;"><strong>Previous Last Contact Date:</strong> ${oldLog?.lastContactDate || 'Not provided'}</p>
                <p style="margin: 10px 0;"><strong>Updated Last Contact Date:</strong> ${reviewDetail.lastContactDate || 'Not provided'}</p>


                <p style="margin: 10px 0;"><strong>Previous Methods Tried:</strong> ${oldLog?.methodsTried || 'Not provided'}</p>
                <p style="margin: 10px 0;"><strong>Updated Methods Tried:</strong> ${reviewDetail.methodsTried || 'Not provided'}</p>

                <p style="margin: 10px 0;"><strong>Previous Notes:</strong> ${oldLog?.notes || 'Not provided'}</p>
                <p style="margin: 10px 0;"><strong>Updated Notes:</strong> ${reviewDetail.notes || 'Not provided'}</p>



                <p style="margin: 10px 0;"><strong>Previous Methods Left:</strong> ${oldLog?.methodsLeft || 'Not provided'}</p>
                <p style="margin: 10px 0;"><strong>Updated Methods Left:</strong> ${reviewDetail.methodsLeft || 'Not provided'}</p>


                <p style="margin: 10px 0;"><strong>Previous Who Updated:</strong> ${oldLog?.whoUpdated || 'Unknown'}</p>
                <p style="margin: 10px 0;"><strong>Updated Who Updated:</strong> ${reviewDetail.whoUpdated || 'Unknown'}</p>

                <p style="margin: 10px 0;"><strong> Previous Claim Resolution Status:</strong> 
                    <span style="padding: 4px 8px; border-radius: 4px; font-weight: bold; background-color: ${oldLog?.claimResolutionStatus === 'Completed' ? '#d4edda' :
                oldLog?.claimResolutionStatus === 'In Progress' ? '#fff3cd' :
                    '#f8d7da'
            };">
                        ${oldLog?.claimResolutionStatus}
                    </span>
                </p>

                <p style="margin: 10px 0;"><strong>Updated Claim Resolution Status:</strong> 
                    <span style="padding: 4px 8px; border-radius: 4px; font-weight: bold; background-color: ${reviewDetail.claimResolutionStatus === 'Completed' ? '#d4edda' :
                reviewDetail.claimResolutionStatus === 'In Progress' ? '#fff3cd' :
                    '#f8d7da'
            };">
                        ${reviewDetail.claimResolutionStatus}
                    </span>
                </p>
            </div>

            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
                <p>This is an automated notification. Please do not reply directly to this email.</p>
            </div>
        </div>
    </body>
</html>
`;

        await sendEmail(subject, html, process.env.EMAIL_FROM, 'receipts@luxurylodgingstr.com');
    } catch (error) {
        console.error('Error sending review update email:', error);
    }
}
