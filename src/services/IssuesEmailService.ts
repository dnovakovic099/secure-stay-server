import sendEmail from "../utils/sendEmai";

function getDaysSinceCreation(createdAt: Date): number {
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - new Date(createdAt).getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getStatusColor(status: string): string {
  switch (status) {
    case "In Progress":
      return "#fff3cd";
    case "Overdue":
      return "#ffe1e1";
    case "Need Help":
      return "#ffe1e1";
    default:
      return "#f8f9fa";
  }
}

export async function sendUnresolvedIssuesEmail(issues: any[]) {
  try {
    if (!issues || issues.length === 0) {
      console.log("No unresolved issues to send");
      return;
    }

    const subject = `Unresolved Issues Alert - ${issues.length} Issue(s)`;

    // Build table rows
    const tableRows = issues
      .map((issue, index) => {
        const daysOpen = getDaysSinceCreation(issue.created_at);
        const createdDate = new Date(issue.created_at).toLocaleDateString(
          "en-US",
          {
            year: "numeric",
            month: "short",
            day: "numeric",
          }
        );

        const statusBgColor = getStatusColor(issue.status);
        const rowBgColor = index % 2 === 0 ? "#ffffff" : "#f8f9fa";

        return `
                <tr style="background-color: ${rowBgColor};">
                    <td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${
                      issue.id
                    }</td>
                    <td style="padding: 12px; border-bottom: 1px solid #ddd;">
                        <span style="padding: 4px 8px; border-radius: 4px; background-color: ${statusBgColor}; font-size: 13px;">
                            ${issue.status || "N/A"}
                        </span>
                    </td>
                    <td style="padding: 12px; border-bottom: 1px solid #ddd; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${
                      issue.listing_name || "N/A"
                    }</td>
                    <td style="padding: 12px; border-bottom: 1px solid #ddd; max-width: 250px; overflow: hidden; text-overflow: ellipsis;" title="${(
                      issue.issue_description || ""
                    ).replace(/"/g, "&quot;")}">${
          issue.issue_description || "No description"
        }</td>
                    <td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${createdDate}</td>
                    <td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${daysOpen}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #ddd;">${
                      issue.guest_name || "N/A"
                    }</td>
                    <td style="padding: 12px; border-bottom: 1px solid #ddd;">${
                      issue.guest_contact_number || "N/A"
                    }</td>
                </tr>
            `;
      })
      .join("");

    const html = `
            <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333; margin: 0;">
                    <div style="max-width: 1200px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                        <h2 style="color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 15px; margin-bottom: 25px;">
                            Unresolved Issues Alert
                        </h2>
                        
                        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                            <p style="margin: 0; font-size: 16px; font-weight: bold; color: #856404;">
                                ⚠️ You have <strong>${
                                  issues.length
                                }</strong> unresolved issue(s) that require attention.
                            </p>
                        </div>

                        <div style="overflow-x: auto; margin-bottom: 25px;">
                            <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd; font-size: 14px; background-color: #ffffff;">
                                <thead>
                                    <tr style="background-color: #2c3e50; color: #ffffff;">
                                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #1a1a1a; font-weight: bold;">ID</th>
                                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #1a1a1a; font-weight: bold;">Status</th>
                                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #1a1a1a; font-weight: bold;">Listing</th>
                                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #1a1a1a; font-weight: bold;">Description</th>
                                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #1a1a1a; font-weight: bold;">Created</th>
                                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #1a1a1a; font-weight: bold;">Days Open</th>
                                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #1a1a1a; font-weight: bold;">Guest Name</th>
                                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #1a1a1a; font-weight: bold;">Contact</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tableRows}
                                </tbody>
                            </table>
                        </div>

                        <div style="margin-top: 25px; padding-top: 20px; border-top: 2px solid #eee; font-size: 12px; color: #666; text-align: center;">
                            <p style="margin: 5px 0;">This is an automated message. Please review and address these issues promptly.</p>
                            <p style="margin: 5px 0; color: #999;">Generated on ${new Date().toLocaleString(
                              "en-US",
                              { dateStyle: "long", timeStyle: "short" }
                            )}</p>
                        </div>
                    </div>
                </body>
            </html>
        `;

    await sendEmail(
      subject,
      html,
      process.env.EMAIL_FROM,
      process.env.EMAIL_TO
    );

    console.log(
      `Successfully sent email with ${issues.length} unresolved issues`
    );
  } catch (error) {
    console.error("Error sending unresolved issues alert:", error);
  }
}

// Keep the old function for backward compatibility if needed
export async function sendUnresolvedIssueEmail(issue: any) {
  await sendUnresolvedIssuesEmail([issue]);
}
