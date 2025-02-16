import sendEmail from "../utils/sendEmai";


export async function sendUnresolvedIssueEmail(issue: any) {
        try {
            const daysOpen = this.getDaysSinceCreation(issue.created_at);
            const createdDate = new Date(issue.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            const subject = `Unresolved Issue Alert - ID: ${issue.id}`;
            
            const html = `
                <html>
                    <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
                        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <h2 style="color: #2c3e50; border-bottom: 2px solid #eee; padding-bottom: 10px;">Unresolved Issue Alert</h2>
                            
                            <div style="margin: 20px 0;">
                                <p style="margin: 10px 0;"><strong>Status:</strong> 
                                    <span style="padding: 4px 8px; border-radius: 4px; background-color: ${
                                        issue.status === 'In Progress' ? '#fff3cd' : 
                                        issue.status === 'Overdue' ? '#ffe1e1' : 
                                        issue.status === 'Need Help' ? '#ffe1e1' : '#f8f9fa'
                                    };">
                                        ${issue.status}
                                    </span>
                                </p>
                                <p style="margin: 10px 0;"><strong>Issue ID:</strong> ${issue.id}</p>
                                <p style="margin: 10px 0;"><strong>Listing:</strong> ${issue.listing_name || 'N/A'}</p>
                                <p style="margin: 10px 0;"><strong>Description:</strong> ${issue.issue_description || 'No description provided'}</p>
                                <p style="margin: 10px 0;"><strong>Created Date:</strong> ${createdDate}</p>
                                <p style="margin: 10px 0;"><strong>Days Open:</strong> ${daysOpen}</p>
                                <p style="margin: 10px 0;"><strong>Guest Name:</strong> ${issue.guest_name || 'N/A'}</p>
                                <p style="margin: 10px 0;"><strong>Guest Contact:</strong> ${issue.guest_contact_number || 'N/A'}</p>
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
            console.error('Error sending unresolved issue alert:', error);
        }
    }

    function getDaysSinceCreation(createdAt: Date): number {
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - new Date(createdAt).getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
