import { AsanaClient } from '../client/AsanaClient';
import { ClientEntity } from '../entity/Client';
import { ClientPropertyEntity } from '../entity/ClientProperty';
import { PropertyServiceInfo } from '../entity/PropertyServiceInfo';
import { PropertyOnboarding } from '../entity/PropertyOnboarding';
import logger from '../utils/logger.utils';

// Service Type enum mapping from DB value to Asana enum option GID
const SERVICE_TYPE_ENUM_MAP: Record<string, string> = {
    'LAUNCH': '1210870312729412',
    'Launch': '1210870312729412',
    'PRO': '1210870312729413',
    'Pro': '1210870312729413',
    'FULL': '1210870312729414',
    'Full': '1210870312729414',
};

// Mgt Fee enum mapping from percentage value to Asana enum option GID
const MGT_FEE_ENUM_MAP: Record<string, string> = {
    '4': '1210870312729420',
    '5': '1210870312729421',
    '7': '1210870312729422',
    '8': '1210870312729423',
    '10': '1210870312729417',
    '11': '1211486717872769',
    '12.5': '1210870312729424',
    '15': '1210870312729418',
    '17': '1210870312729425',
    '17.5': '1210870312729426',
    '20': '1210870312729419',
    '25': '1212425272753183',
};

interface OnboardingTaskData {
    client: ClientEntity;
    property: ClientPropertyEntity;
    serviceInfo?: PropertyServiceInfo | null;
    onboarding?: PropertyOnboarding | null;
}

export class AsanaService {
    private client: AsanaClient;

    constructor() {
        this.client = new AsanaClient();
    }

    /**
     * Create an onboarding task in Asana for a newly signed property.
     * Uses custom fields when GIDs are configured, otherwise falls back to description.
     */
    async createOnboardingTask(data: OnboardingTaskData): Promise<void> {
        // Skip if Asana is not configured
        if (!this.client.isConfigured()) {
            logger.info('Asana integration is not configured. Skipping onboarding task creation.');
            return;
        }

        const { client, property, serviceInfo, onboarding } = data;

        // Build task name: Full Client Name - Street Address, Unit #
        const clientName = `${client.firstName} ${client.lastName}`.trim();
        let taskName = clientName;
        if (property.streetAddress) {
            taskName += ` - ${property.streetAddress}`;
            if (property.unitNumber) {
                taskName += `, Unit ${property.unitNumber}`;
            }
        } else if (property.address) {
            taskName += ` - ${property.address}`;
        }

        // Build custom fields and description based on available GIDs
        const customFields: Record<string, string | number | { date: string; }> = {};
        const descriptionParts: string[] = [];

        // Phone
        const phone = this.formatPhone(client.dialCode, client.phone);
        if (process.env.ASANA_CF_PHONE && phone) {
            customFields[process.env.ASANA_CF_PHONE] = phone;
        } else if (phone) {
            descriptionParts.push(`Phone: ${phone}`);
        }

        // Client Time Zone
        if (process.env.ASANA_CF_TIMEZONE && client.timezone) {
            customFields[process.env.ASANA_CF_TIMEZONE] = client.timezone;
        } else if (client.timezone) {
            descriptionParts.push(`Client Time Zone: ${client.timezone}`);
        }

        // Service Type (enum field)
        if (process.env.ASANA_CF_SERVICE_TYPE && serviceInfo?.serviceType) {
            const enumGid = SERVICE_TYPE_ENUM_MAP[serviceInfo.serviceType];
            if (enumGid) {
                customFields[process.env.ASANA_CF_SERVICE_TYPE] = enumGid;
            } else {
                descriptionParts.push(`Service Type: ${serviceInfo.serviceType}`);
            }
        } else if (serviceInfo?.serviceType) {
            descriptionParts.push(`Service Type: ${serviceInfo.serviceType}`);
        }

        // Sales Notes
        if (process.env.ASANA_CF_SALES_NOTES && onboarding?.salesNotes) {
            customFields[process.env.ASANA_CF_SALES_NOTES] = onboarding.salesNotes;
        } else if (onboarding?.salesNotes) {
            descriptionParts.push(`Sales Notes: ${onboarding.salesNotes}`);
        }

        // Sales Agent (fallback to description if no GID)
        const salesAgent = onboarding?.salesRepresentative;
        if (process.env.ASANA_CF_SALES_AGENT && salesAgent) {
            customFields[process.env.ASANA_CF_SALES_AGENT] = salesAgent;
        } else if (salesAgent) {
            descriptionParts.push(`Sales Agent: ${salesAgent}`);
        }

        // Client Name - Not needed (task name is already client name)

        // Email (fallback to description if no GID)
        if (process.env.ASANA_CF_EMAIL && client.email) {
            customFields[process.env.ASANA_CF_EMAIL] = client.email;
        } else if (client.email) {
            descriptionParts.push(`Email: ${client.email}`);
        }

        // Property Address (fallback to description if no GID)
        if (process.env.ASANA_CF_PROPERTY_ADDRESS && property.address) {
            customFields[process.env.ASANA_CF_PROPERTY_ADDRESS] = property.address;
        } else if (property.address) {
            descriptionParts.push(`Property Address: ${property.address}`);
        }

        // Mgt Fee (enum field)
        const mgtFee = serviceInfo?.managementFee;
        if (process.env.ASANA_CF_MGT_FEE && mgtFee) {
            const enumGid = MGT_FEE_ENUM_MAP[mgtFee];
            if (enumGid) {
                customFields[process.env.ASANA_CF_MGT_FEE] = enumGid;
            } else {
                // Use 'Others' option if value not in mapping
                customFields[process.env.ASANA_CF_MGT_FEE] = '1210870312729484';
                descriptionParts.push(`Mgt Fee: ${mgtFee}%`);
            }
        } else if (mgtFee) {
            descriptionParts.push(`Mgt Fee: ${mgtFee}%`);
        }

        // Current Listing Link
        const listingLink = onboarding?.clientCurrentListingLink;
        if (process.env.ASANA_CF_CURRENT_LISTING_LINK && listingLink) {
            // Parse if JSON array, otherwise use as-is
            let linkValue = listingLink;
            try {
                const parsed = JSON.parse(listingLink);
                if (Array.isArray(parsed)) {
                    linkValue = parsed.join(', ');
                }
            } catch {
                // Not JSON, use as-is
            }
            customFields[process.env.ASANA_CF_CURRENT_LISTING_LINK] = linkValue;
        } else if (listingLink) {
            descriptionParts.push(`Current Listing Link: ${listingLink}`);
        }

        // Target Start Date (date field - requires object format)
        if (process.env.ASANA_CF_TARGET_START_DATE && onboarding?.targetStartDate) {
            const dateStr = this.formatDate(onboarding.targetStartDate);
            if (dateStr) {
                customFields[process.env.ASANA_CF_TARGET_START_DATE] = { date: dateStr };
            }
        } else if (onboarding?.targetStartDate) {
            descriptionParts.push(`Target Start Date: ${onboarding.targetStartDate}`);
        }

        // Target Live Date (date field - requires object format)
        if (process.env.ASANA_CF_TARGET_LIVE_DATE && onboarding?.targetLiveDate) {
            const dateStr = this.formatDate(onboarding.targetLiveDate);
            if (dateStr) {
                customFields[process.env.ASANA_CF_TARGET_LIVE_DATE] = { date: dateStr };
            }
        } else if (onboarding?.targetLiveDate) {
            descriptionParts.push(`Target Live Date: ${onboarding.targetLiveDate}`);
        }

        // Build final description
        const notes = descriptionParts.length > 0
            ? descriptionParts.join('\n')
            : undefined;

        // Create task in Asana
        await this.client.createTaskInSection({
            name: taskName,
            notes,
            customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
        });

        logger.info(`Asana task created for property: ${property.address}`);
    }

    /**
     * Format phone number with dial code
     */
    private formatPhone(dialCode?: string, phone?: string): string | null {
        if (!phone) return null;
        if (dialCode) {
            return `${dialCode} ${phone}`;
        }
        return phone;
    }

    /**
     * Format date for Asana (YYYY-MM-DD format)
     */
    private formatDate(date: string | Date | null | undefined): string | null {
        if (!date) return null;
        try {
            const d = new Date(date);
            if (isNaN(d.getTime())) return null;
            return d.toISOString().split('T')[0];
        } catch {
            return null;
        }
    }
}

// Singleton instance
export const asanaService = new AsanaService();
