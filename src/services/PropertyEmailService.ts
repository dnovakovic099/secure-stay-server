import fs from "fs";
import ejs from "ejs";
import path from "path";
import { sendSupportEmail } from "../utils/sendSupportEmail";
import logger from "../utils/logger.utils";
import { ClientEntity } from "../entity/Client";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { UsersService } from "./UsersService";

/**
 * Service for handling property-related email notifications.
 * Uses the Support email account for sending.
 */
export class PropertyEmailService {
    private templatePath = path.join(process.cwd(), "src", "template");
    private usersService = new UsersService();

    /**
     * Send welcome/onboarding email when a new property is added to a client.
     * This email is sent asynchronously and failures do not block the main flow.
     * 
     * @param client - The client entity (owner of the property)
     * @param property - The newly created property entity
     * @param userId - The ID of the user who created the property (used to get API key)
     */
    async sendPropertyOnboardingEmail(
        client: ClientEntity,
        property: ClientPropertyEntity,
        userId: string
    ): Promise<void> {
        try {
            // Validate client email exists
            if (!client.email) {
                logger.warn(`Cannot send onboarding email: Client ${client.id} has no email`);
                return;
            }

            // Fetch the API key for the user who created the property
            const { apiKey } = await this.usersService.getApiKey(userId);
            if (!apiKey) {
                logger.warn(`Cannot send onboarding email: No API key found for user ${userId}`);
                return;
            }

            // Read the email template
            const templateFile = path.join(
                this.templatePath,
                "property-onboarding-welcome.template.html"
            );

            if (!fs.existsSync(templateFile)) {
                logger.error(`Email template not found: ${templateFile}`);
                return;
            }

            const templateContent = fs.readFileSync(templateFile, "utf8");

            // Generate the onboarding form link
            // Format: {CLIENT_URL}/client-listing-intake-update/{clientId}/{apiKey}?propertyId={propertyId}
            const obFormLink = `${process.env.CLIENT_URL}/client-listing-intake-update/${client.id}/${apiKey}?propertyId=${property.id}`;

            // Render the template with client data
            const html = ejs.render(templateContent, {
                clientFirstName: client.preferredName || client.firstName,
                obFormLink,
                propertyAddress: property.address || "Your Property",
            });

            const subject = "⚡ Welcome to Luxury Lodging – Getting Started with Your Onboarding";

            // Send the email via Support account
            await sendSupportEmail(client.email, subject, html);

            logger.info(`Property onboarding email sent to ${client.email} for property ${property.id}`);
        } catch (error) {
            logger.error(`Failed to send property onboarding email to ${client.email}:`, error);
            // Don't throw - email sending should not block the main flow
        }
    }
}

// Export singleton instance for convenience
export const propertyEmailService = new PropertyEmailService();
