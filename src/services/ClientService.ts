import { appDatabase } from "../utils/database.util";
import { ClientEntity } from "../entity/Client";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { ClientSecondaryContact } from "../entity/ClientSecondaryContact";
import CustomErrorHandler from "../middleware/customError.middleware";
import { In, IsNull, Not } from "typeorm";
import { ListingService } from "./ListingService";
import { tagIds } from "../constant"
import { ClientTicket } from "../entity/ClientTicket";
import { PropertyOnboarding } from "../entity/PropertyOnboarding";
import { PropertyServiceInfo } from "../entity/PropertyServiceInfo";
import { PropertyInfo } from "../entity/PropertyInfo";
import { PropertyBedTypes } from "../entity/PropertyBedTypes";
import logger from "../utils/logger.utils";
import { HostAwayClient } from "../client/HostAwayClient";
import { PropertyUpsells } from "../entity/PropertyUpsells";
import { PropertyParkingInfo } from "../entity/PropertyParkingInfo";
import { PropertyBathroomLocation } from "../entity/PropertyBathroomLocation";
import { PropertyVendorManagement } from "../entity/PropertyVendorManagement";
import { SuppliesToRestock } from "../entity/SuppliesToRestock";
import { VendorInfo } from "../entity/VendorInfo";

interface ClientFilter {
  page: number;
  limit: number;
  keyword?: string;
  listingId?: string[];
  serviceType?: string[];
  status?: string[];
  source?: string;
}

// types/propertyOnboarding.ts
interface PropertyOnboardingRequest {
  clientId: string;
  clientProperties: Property[];
}

interface Property {
  id?: string; // Optional for create/update logic
  address: string;
  onboarding: Onboarding;
}

interface Onboarding {
  serviceInfo: ServiceInfo;
  sales: Sales;
  listing: Listing;
  photography: Photography;
  financials?: Financials;
}

interface ServiceInfo {
  managementFee: number | null;
  serviceType: "LAUNCH" | "PRO" | "FULL";
  contractLink: string | null;
  serviceNotes: string | null;
}

interface Sales {
  salesRepresentative: string | null;
  salesNotes: string | null;
  projectedRevenue: number | null;
}

interface Listing {
  clientCurrentListingLink: string[] | null;
  listingOwner: "Luxury Lodging" | "Client" | null;
  clientListingStatus: "Closed" | "Open - Will Close" | "Open - Keeping" | null;
  targetLiveDate: string | null;  // yyyy-mm-dd
  targetStartDate: string | null; // yyyy-mm-dd
  targetDateNotes: string | null;
  upcomingReservations: string | null;
  actualLiveDate?: string | null;  // yyyy-mm-dd
  actualStartDate?: string | null; // yyyy-mm-dd

  // Client-facing onboarding specific fields
  acknowledgePropertyReadyByStartDate?: boolean | null;
  agreesUnpublishExternalListings?: boolean | null;
  externalListingNotes?: string | null;
  acknowledgesResponsibilityToInform?: boolean | null;

  // Property listing info fields
  propertyTypeId?: number | null;
  noOfFloors?: number | null;
  squareMeters?: number | null;
  personCapacity?: number | null;
  roomType?: string | null;
  bedroomsNumber?: number | null;
  propertyBedTypes?: Array<{
    floorLevel: number;
    bedroomNumber: number;
    bedTypeId: number;
    quantity: number;
  }> | null;
  bathroomType?: string | null;
  bathroomsNumber?: number | null;
  guestBathroomsNumber?: number | null;
  propertyBathroomLocation?: Array<{
    id?: number;
    floorLevel?: number | null;
    bathroomType?: any;
    bathroomNumber?: number | null;
    ensuite?: number | null;
  }> | null;
  checkInTimeStart?: number | null;
  checkOutTime?: number | null;
  canAnyoneBookAnytime?: string | null;
  bookingAcceptanceNoticeNotes?: string | null;
  allowPartiesAndEvents?: boolean | null;
  allowSmoking?: boolean | null;
  allowPets?: boolean | null;
  petFee?: number | null;
  numberOfPetsAllowed?: number | null;
  petRestrictionsNotes?: string | null;
  allowChildreAndInfants?: boolean | null;
  allowLuggageDropoffBeforeCheckIn?: boolean | null;
  otherHouseRules?: string | null;
  parkingType?: string[] | null;
  parkingFee?: number | null;
  numberOfParkingSpots?: number | null;
  parkingInstructions?: string | null;
  parking?: Array<{
    id?: number;
    parkingType: string;
    parkingFee?: number | null;
    numberOfParkingSpots?: number | null;
  }> | null;
  checkInProcess?: string[] | null;
  doorLockType?: string[] | null;
  doorLockCodeType?: string | null;
  codeResponsibleParty?: string | null;
  doorLockAppName?: string | null;
  doorLockAppUsername?: string | null;
  doorLockAppPassword?: string | null;
  lockboxLocation?: string | null;
  lockboxCode?: string | null;
  doorLockInstructions?: string | null;
  wasteCollectionDays?: string | null;
  wasteBinLocation?: string | null;
  wasteManagementInstructions?: string | null;
  propertyUpsells?: Array<{
    upsellName: string;
    allowUpsell: boolean;
    feeType: string;
    fee?: number | null;
    maxAdditionalHours: number | null;
  }> | null;
  additionalServiceNotes?: string | null;
  amenities?: string[] | null;
  wifiUsername?: string | null;
  wifiPassword?: string | null;
  wifiSpeed?: string | null;
  locationOfModem?: string | null;
  swimmingPoolNotes?: string | null;
  hotTubInstructions?: string | null;

  // Vendor Management
  vendorManagement?: {
    // Cleaner
    cleanerManagedBy?: string | null;
    cleanerManagedByReason?: string | null;
    hasCurrentCleaner?: string | null;
    cleaningFee?: number | null;
    cleanerName?: string | null;
    cleanerPhone?: string | null;
    cleanerEmail?: string | null;
    acknowledgeCleanerResponsibility?: boolean | null;
    acknowledgeCleanerResponsibilityReason?: string | null;
    ensureCleanersScheduled?: boolean | null;
    ensureCleanersScheduledReason?: string | null;
    propertyCleanedBeforeNextCheckIn?: boolean | null;
    propertyCleanedBeforeNextCheckInReason?: string | null;
    luxuryLodgingReadyAssumption?: boolean | null;
    luxuryLodgingReadyAssumptionReason?: string | null;
    cleaningTurnoverNotes?: string | null;

    // Restocking Supplies
    restockingSuppliesManagedBy?: string | null;
    restockingSuppliesManagedByReason?: string | null;
    luxuryLodgingRestockWithoutApproval?: boolean | null;
    luxuryLodgingConfirmBeforePurchase?: boolean | null;
    suppliesToRestock?: Array<{
      id?: number;
      supplyName: string;
      notes?: string | null;
    }> | null;

    // Other Contractors/Vendors
    vendorInfo?: Array<{
      id?: number;
      workCategory: string;
      managedBy: string;
      name?: string | null;
      contact?: string | null;
      email?: string | null;
      scheduleType?: string | null;
      intervalMonth?: number | null;
      dayOfWeek?: any;
      weekOfMonth?: number | null;
      dayOfMonth?: number | null;
      notes?: string | null;
    }> | null;

    addtionalVendorManagementNotes?: string | null;
    acknowledgeExpensesBilledToStatement?: any;
  } | null;
}

interface Photography {
  photographyCoverage:
  | "Yes (Covered by Luxury Lodging)"
  | "Yes (Covered by Client)"
  | "No"
  | null;
  photographyNotes: string | null;
}

interface Financials {
  minPrice?: number | null;
  minNights?: number | null;
  maxNights?: number | null;
  propertyLicenseNumber?: string | null;
  tax?: string | null;
  financialNotes?: string | null;
}


export class ClientService {
  private clientRepo = appDatabase.getRepository(ClientEntity);
  private propertyRepo = appDatabase.getRepository(ClientPropertyEntity);
  private contactRepo = appDatabase.getRepository(ClientSecondaryContact);
  private clientTicketRepo = appDatabase.getRepository(ClientTicket);

  private propertyOnboardingRepo = appDatabase.getRepository(PropertyOnboarding);
  private propertyServiceInfoRepo = appDatabase.getRepository(PropertyServiceInfo);
  private propertyInfoRepo = appDatabase.getRepository(PropertyInfo);
  private propertyBedTypesRepo = appDatabase.getRepository(PropertyBedTypes);
  private propertyUpsellsRepo = appDatabase.getRepository(PropertyUpsells);
  private propertyParkingInfoRepo = appDatabase.getRepository(PropertyParkingInfo);
  private propertyBathroomLocationRepo = appDatabase.getRepository(PropertyBathroomLocation);
  private propertyVendorManagementRepo = appDatabase.getRepository(PropertyVendorManagement);
  private suppliesToRestockRepo = appDatabase.getRepository(SuppliesToRestock);
  private vendorInfoRepo = appDatabase.getRepository(VendorInfo);

  private hostawayClient = new HostAwayClient();

  async saveClient(
    clientData: Partial<ClientEntity>,
    userId: string,
    source: string,
    secondaryContacts?: Partial<ClientSecondaryContact>[],
    clientProperties?: string[],
  ) {
    const listingService = new ListingService();
    const { FULL_SERVICE, PRO_SERVICE, LAUNCH_SERVICE } = await listingService.getListingIdsForEachServiceType(userId);

    if (clientProperties && clientProperties.length > 0) {
      for (const listingId of clientProperties) {
        //find the service type of the listingId by checking which array it belongs to
        if (FULL_SERVICE.includes(Number(listingId))) {
          clientData.serviceType = "FULL_SERVICE";
        } else if (PRO_SERVICE.includes(Number(listingId))) {
          clientData.serviceType = "PRO_SERVICE";
        } else if (LAUNCH_SERVICE.includes(Number(listingId))) {
          clientData.serviceType = "LAUNCH_SERVICE";
        } else {
          clientData.serviceType = null;
        }
      }
      clientData.status = "active"; // if properties are associated, set status to Active
    } else {
      clientData.status = "onboarding"; // if no properties are associated, set status to Onboarding
    }

    const client = this.clientRepo.create({ ...clientData, createdBy: userId, source });

    if (secondaryContacts && secondaryContacts.length > 0) {
      client.secondaryContacts = secondaryContacts.map((contact) =>
        this.contactRepo.create({ ...contact, createdBy: userId })
      );
    }

    if (clientProperties && clientProperties.length > 0) {
      client.properties = clientProperties.map((listingId) =>
        this.propertyRepo.create({ listingId, createdBy: userId })
      );
    }

    return await this.clientRepo.save(client);
  }

  async updateClient(
    clientData: Partial<ClientEntity>,
    userId: string,
    secondaryContacts?: Partial<ClientSecondaryContact>[],
    clientProperties?: string[],
  ) {
    const listingService = new ListingService();
    const { FULL_SERVICE, PRO_SERVICE, LAUNCH_SERVICE } = await listingService.getListingIdsForEachServiceType(userId);

    if (clientProperties && clientProperties.length > 0) {
      for (const listingId of clientProperties) {
        //find the service type of the listingId by checking which array it belongs to
        if (FULL_SERVICE.includes(Number(listingId))) {
          clientData.serviceType = "FULL_SERVICE";
        } else if (PRO_SERVICE.includes(Number(listingId))) {
          clientData.serviceType = "PRO_SERVICE";
        } else if (LAUNCH_SERVICE.includes(Number(listingId))) {
          clientData.serviceType = "LAUNCH_SERVICE";
        } else {
          clientData.serviceType = null;
        }
      }
      clientData.status = "active";
    } else {
      clientData.status = "onboarding"; // if no properties are associated, set status to Onboarding
    }
    
    const client = await this.clientRepo.findOne({ where: { id: clientData.id } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    Object.assign(client, clientData);
    client.updatedAt = new Date();
    client.updatedBy = userId;

    await this.handleClientSecondaryContactUpdate(client, userId, secondaryContacts);
    await this.handleClientPropertiesUpdate(client, userId, clientProperties);

    return await this.clientRepo.save(client);
  }

  private async handleClientSecondaryContactUpdate(client: ClientEntity, userId: string, secondaryContacts?: Partial<ClientSecondaryContact>[]) {
    if (secondaryContacts) {
      const existingContacts = await this.contactRepo.find({ where: { client: { id: client.id } } });
      const existingContactIds = existingContacts.map((c) => c.id);
      const incomingContactIds = secondaryContacts.map((c) => c.id).filter((id): id is string => !!id);

      // Delete contacts that are not in the incoming list
      const contactsToDelete = existingContacts.filter((c) => !incomingContactIds.includes(c.id));
      if (contactsToDelete.length > 0) {
        //updated deletedBy and deletedAt instead of hard delete
        contactsToDelete.forEach(contact => {
          contact.deletedAt = new Date();
          contact.deletedBy = userId;
        });
        await this.contactRepo.save(contactsToDelete);
      }

      // Update or create contacts
      client.secondaryContacts = secondaryContacts.map((contact) => {
        if (contact.id && existingContactIds.includes(contact.id)) {
          const existingContact = existingContacts.find((c) => c.id === contact.id)!;
          Object.assign(existingContact, contact);
          existingContact.updatedAt = new Date();
          existingContact.updatedBy = userId;
          return existingContact;
        } else {
          return this.contactRepo.create({ ...contact, createdBy: userId });
        }
      });
    }
  }

  private async handleClientPropertiesUpdate(client: ClientEntity, userId: string, clientProperties?: string[]) {
    if (clientProperties) {
      const existingProperties = await this.propertyRepo.find({ where: { client: { id: client.id } } });
      const existingListingIds = existingProperties.map((p) => p.listingId);

      // Delete properties that are not in the incoming list
      const propertiesToDelete = existingProperties.filter((p) => !clientProperties.includes(p.listingId));
      if (propertiesToDelete.length > 0) {
        //updated deletedBy and deletedAt instead of hard delete
        propertiesToDelete.forEach(property => {
          property.deletedAt = new Date();
          property.deletedBy = userId;
        });
        await this.propertyRepo.save(propertiesToDelete);
      }

      // Add new properties
      const newProperties = clientProperties
        .filter((listingId) => !existingListingIds.includes(listingId))
        .map((listingId) => this.propertyRepo.create({ listingId, createdBy: userId }));

      client.properties = [...existingProperties.filter(p => !propertiesToDelete.includes(p)), ...newProperties];
    }
  }

  async getClientList(filter: ClientFilter, userId: string) {
    const { page, limit, keyword } = filter;

    // fetch the associated clientSecondaryContacts and clientProperties as well
    const query = this.clientRepo.createQueryBuilder("client")
      .leftJoinAndSelect("client.secondaryContacts", "secondaryContact", "secondaryContact.deletedAt IS NULL")
      .leftJoinAndSelect("client.properties", "property", "property.deletedAt IS NULL")
      //fetch the onboarding, serviceInfo and propertyInfo of the property as well
      .leftJoinAndSelect("property.onboarding", "onboarding", "onboarding.deletedAt IS NULL")
      .leftJoinAndSelect("property.serviceInfo", "serviceInfo", "serviceInfo.deletedAt IS NULL")
      .leftJoinAndSelect("property.propertyInfo", "propertyInfo", "propertyInfo.deletedAt IS NULL")
      .where("client.deletedAt IS NULL");

    if (keyword) {
      const k = `%${keyword.toLowerCase()}%`;
      query.andWhere(
        `(LOWER(client.firstName) LIKE :keyword 
        OR LOWER(client.lastName) LIKE :keyword 
        OR LOWER(client.email) LIKE :keyword)`,
        { keyword: k }
      );
    }

    if (filter.listingId && filter.listingId.length > 0) {
      query.andWhere("property.listingId IN (:...listingIds)", { listingIds: filter.listingId });
    }

    if (filter.serviceType && filter.serviceType.length > 0) {
      query.andWhere("client.serviceType IN (:...serviceTypes)", { serviceTypes: filter.serviceType });
    }

    if (filter.status && filter.status.length > 0) {
      query.andWhere("client.status IN (:...statuses)", { statuses: filter.status });
    }

    if (filter.source) {
      query.andWhere("client.source = :source", { source: filter.source });
    }

    query.skip((page - 1) * limit).take(limit);

    const [data, total] = await query.getManyAndCount();

    const listingService = new ListingService();
    const listings = await listingService.getListingNames(userId);

    const transformedData = await Promise.all(data.map(async (client) => {
      if (client.properties) {
        client.properties = client.properties.map((property) => {
          const listing = listings.find((l) => l.id === Number(property.listingId));
          return { ...property, listingName: listing ? listing.internalListingName : "Unknown Listing" };
        });
      }
      const listingIds = client.properties ? client.properties.map(p => p.listingId) : [];
      const clientSatisfaction = await this.getClientSatisfactionData(listingIds);
      return { ...client, clientSatisfaction };
    }));

    const satisfactionCounts = transformedData.reduce(
      (acc, client) => {
        if (client.clientSatisfaction) {
          acc[client.clientSatisfaction] = (acc[client.clientSatisfaction] || 0) + 1;
        }
        return acc;
      },
      { "Satisfied": 0, "Neutral": 0, "Dissatisfied": 0 }
    );

    return { 
      total,
      data: transformedData,
      satisfactionCounts
    };

  }

  async deleteClient(clientId: string, userId: string) {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
       throw CustomErrorHandler.notFound("Client not found");
     }

     // Soft delete by setting deletedAt and deletedBy
     client.deletedAt = new Date();
     client.deletedBy = userId;
     await this.clientRepo.save(client);
   }

   async getClientMetadata() {
    //status can be one of active, at_risk, offboarding, offboarded
    // find the total no. of clients whose status is other than offboarded
    const totalActiveClients = await this.clientRepo.count({ where: { status: Not("offboarded"), deletedAt: IsNull() } });
    // total no. of each serviceType of clients whose status is other than offboarded
    const serviceTypeCounts = await this.clientRepo.createQueryBuilder("client")
      .select("client.serviceType", "serviceType")
      .addSelect("COUNT(*)", "count")
      .where("client.status != :status AND client.deletedAt IS NULL", { status: "offboarded" })
      .groupBy("client.serviceType")
      .getRawMany();

     return { totalActiveClients, serviceTypeCounts };
   }

  async getClientSatisfactionData(listingIds: string[]) {
    // find the client tickets with these listingIds and find the average of clientSatisfaction field
    const clientTickets = await this.clientTicketRepo.find({
      where: {
        listingId: In(listingIds),
        clientSatisfaction: Not(IsNull()),
        deletedAt: IsNull(),
      },
    });

    if (clientTickets.length === 0) {
      return "Neutral";
    }

    const totalSatisfaction = clientTickets.reduce(
      (sum, ticket) => sum + (ticket.clientSatisfaction || 0),
      0
    );
    const averageSatisfaction = totalSatisfaction / clientTickets.length;

    if (averageSatisfaction >= 1.0 && averageSatisfaction <= 1.8) {
      return "Very Dissatisfied";
    } else if (averageSatisfaction > 1.8 && averageSatisfaction <= 2.6) {
      return "Dissatisfied";
    } else if (averageSatisfaction > 2.6 && averageSatisfaction <= 3.4) {
      return "Neutral";
    } else if (averageSatisfaction > 3.4 && averageSatisfaction <= 4.2) {
      return "Satisfied";
    } else if (averageSatisfaction > 4.2 && averageSatisfaction <= 5.0) {
      return "Very Satisfied";
    }

    return "Neutral";
  }


  async savePropertyPreOnboardingInfo(body: PropertyOnboardingRequest, userId: string) {
    const { clientId, clientProperties } = body;

    // Ensure client exists
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const results: Array<{ clientProperty: ClientPropertyEntity; serviceInfo: PropertyServiceInfo; onboarding: PropertyOnboarding; }> = [];

    for (const property of clientProperties) {
      // Create ClientProperty
      const clientProperty = this.propertyRepo.create({
        address: property.address,
        status: "draft",
        client: { id: clientId } as any,
        createdBy: userId,
      });
      const savedClientProperty = await this.propertyRepo.save(clientProperty);

      // Map Service Info
      const serviceInfoPayload = property.onboarding?.serviceInfo;
      const serviceInfoEntity = this.propertyServiceInfoRepo.create({
        managementFee: serviceInfoPayload?.managementFee != null ? String(serviceInfoPayload.managementFee) : null,
        serviceType: serviceInfoPayload?.serviceType ?? null,
        contractLink: serviceInfoPayload?.contractLink ?? null,
        serviceNotes: serviceInfoPayload?.serviceNotes ?? null,
        clientProperty: savedClientProperty,
        createdBy: userId,
      });
      const savedServiceInfo = await this.propertyServiceInfoRepo.save(serviceInfoEntity);

      // Map Onboarding (sales, listing, photography)
      const sales = property.onboarding?.sales;
      const listing = property.onboarding?.listing;
      const photography = property.onboarding?.photography;

      const onboardingEntity = this.propertyOnboardingRepo.create({
        // sales
        salesRepresentative: sales?.salesRepresentative ?? null,
        salesNotes: sales?.salesNotes ?? null,
        projectedRevenue: sales?.projectedRevenue != null ? String(sales.projectedRevenue) : null,
        // listing
        clientCurrentListingLink: Array.isArray(listing?.clientCurrentListingLink)
          ? JSON.stringify(listing?.clientCurrentListingLink)
          : (listing?.clientCurrentListingLink as unknown as string) ?? null,
        listingOwner: listing?.listingOwner ?? null,
        clientListingStatus: listing?.clientListingStatus ?? null,
        targetLiveDate: listing?.targetLiveDate ?? null,
        targetStartDate: listing?.targetStartDate ?? null,
        targetDateNotes: listing?.targetDateNotes ?? null,
        upcomingReservations: listing?.upcomingReservations ?? null,
        // photography
        photographyCoverage: photography?.photographyCoverage ?? null,
        photographyNotes: photography?.photographyNotes ?? null,
        // relations/meta
        clientProperty: savedClientProperty,
        createdBy: userId,
      });
      const savedOnboarding = await this.propertyOnboardingRepo.save(onboardingEntity);

      results.push({ clientProperty: savedClientProperty, serviceInfo: savedServiceInfo, onboarding: savedOnboarding });
    }

    return { message: "Property pre-onboarding info saved", results };
  }

  async getPropertyPreOnboardingInfo(clientId: string) {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const clientProperties = await this.propertyRepo
      .createQueryBuilder("cp")
      .leftJoinAndSelect("cp.onboarding", "onboarding")
      .leftJoinAndSelect("cp.serviceInfo", "serviceInfo")
      .where("cp.clientId = :clientId", { clientId })
      .andWhere("cp.deletedAt IS NULL")
      .getMany();

    const data = clientProperties.map((cp) => {
      const si = cp.serviceInfo;
      const ob = cp.onboarding;

      const parsedClientCurrentListingLink = (() => {
        if (!ob?.clientCurrentListingLink) return null;
        try {
          const parsed = JSON.parse(ob.clientCurrentListingLink);
          return Array.isArray(parsed) ? parsed : [String(parsed)];
        } catch (_) {
          return [ob.clientCurrentListingLink];
        }
      })();

      return {
        id: cp.id,
        address: cp.address,
        onboarding: {
          serviceInfo: si
            ? {
              managementFee: si.managementFee != null ? Number(si.managementFee) : null,
              serviceType: si.serviceType ?? null,
              contractLink: si.contractLink ?? null,
              serviceNotes: si.serviceNotes ?? null,
            }
            : null,
          sales: ob
            ? {
              salesRepresentative: ob.salesRepresentative ?? null,
              salesNotes: ob.salesNotes ?? null,
              projectedRevenue: ob.projectedRevenue != null ? Number(ob.projectedRevenue) : null,
            }
            : null,
          listing: ob
            ? {
              clientCurrentListingLink: parsedClientCurrentListingLink,
              listingOwner: ob.listingOwner ?? null,
              clientListingStatus: ob.clientListingStatus ?? null,
              targetLiveDate: ob.targetLiveDate ?? null,
              targetStartDate: ob.targetStartDate ?? null,
              targetDateNotes: ob.targetDateNotes ?? null,
              upcomingReservations: ob.upcomingReservations ?? null,
            }
            : null,
          photography: ob
            ? {
              photographyCoverage: ob.photographyCoverage ?? null,
              photographyNotes: ob.photographyNotes ?? null,
            }
            : null,
        },
      };
    });

    return { clientId, data };
  }

  async updatePropertyPreOnboardingInfo(body: PropertyOnboardingRequest, userId: string) {
    const { clientId, clientProperties } = body;

    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const updated: Array<{ clientProperty: ClientPropertyEntity; serviceInfo?: PropertyServiceInfo | null; onboarding?: PropertyOnboarding | null; }> = [];

    // Handle both update and create scenarios based on id presence
    for (const property of clientProperties as Array<Property & { id?: string; }>) {
      let clientProperty: ClientPropertyEntity;

      if (property.id) {
        // Update existing property
        clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["onboarding", "serviceInfo"] });
        if (!clientProperty) {
          throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
        }
        if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
          throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
        }

        if (property.address !== undefined) {
          clientProperty.address = property.address;
        }
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      } else {
        // Create new property
        clientProperty = this.propertyRepo.create({
          address: property.address,
          status: "draft",
          client: { id: clientId } as any,
          createdBy: userId,
        });
        const savedClientProperty = await this.propertyRepo.save(clientProperty);
        clientProperty = savedClientProperty;
      }

      // Update or Create Service Info if provided
      if (property.onboarding?.serviceInfo) {
        const siPayload = property.onboarding.serviceInfo;
        let si = clientProperty.serviceInfo;
        if (!si) {
          si = this.propertyServiceInfoRepo.create({
            clientProperty,
            createdBy: userId,
            managementFee: siPayload.managementFee != null ? String(siPayload.managementFee) : null,
            serviceType: siPayload.serviceType ?? null,
            contractLink: siPayload.contractLink ?? null,
            serviceNotes: siPayload.serviceNotes ?? null
          });
        } else {
          if (siPayload.managementFee !== undefined) si.managementFee = siPayload.managementFee != null ? String(siPayload.managementFee) : null;
          if (siPayload.serviceType !== undefined) si.serviceType = siPayload.serviceType ?? null;
          if (siPayload.contractLink !== undefined) si.contractLink = siPayload.contractLink ?? null;
          if (siPayload.serviceNotes !== undefined) si.serviceNotes = siPayload.serviceNotes ?? null;
          si.updatedBy = userId;
        }
        await this.propertyServiceInfoRepo.save(si);
      }

      // Update or Create Onboarding if provided
      if (property.onboarding?.sales || property.onboarding?.listing || property.onboarding?.photography) {
        const sales = property.onboarding.sales;
        const listing = property.onboarding.listing;
        const photography = property.onboarding.photography;

        let ob = clientProperty.onboarding;
        if (!ob) {
          // Create new onboarding record with initial values
          ob = this.propertyOnboardingRepo.create({
            clientProperty,
            createdBy: userId,
            salesRepresentative: sales?.salesRepresentative ?? null,
            salesNotes: sales?.salesNotes ?? null,
            projectedRevenue: sales?.projectedRevenue != null ? String(sales.projectedRevenue) : null,
            clientCurrentListingLink: listing?.clientCurrentListingLink ?
              (Array.isArray(listing.clientCurrentListingLink)
                ? JSON.stringify(listing.clientCurrentListingLink)
                : (listing.clientCurrentListingLink as unknown as string)) : null,
            listingOwner: listing?.listingOwner ?? null,
            clientListingStatus: listing?.clientListingStatus ?? null,
            targetLiveDate: listing?.targetLiveDate ?? null,
            targetStartDate: listing?.targetStartDate ?? null,
            targetDateNotes: listing?.targetDateNotes ?? null,
            upcomingReservations: listing?.upcomingReservations ?? null,
            photographyCoverage: photography?.photographyCoverage ?? null,
            photographyNotes: photography?.photographyNotes ?? null
          });
        } else {
          // Update existing onboarding record
          if (sales) {
            if (sales.salesRepresentative !== undefined) ob.salesRepresentative = sales.salesRepresentative ?? null;
            if (sales.salesNotes !== undefined) ob.salesNotes = sales.salesNotes ?? null;
            if (sales.projectedRevenue !== undefined) ob.projectedRevenue = sales.projectedRevenue != null ? String(sales.projectedRevenue) : null;
          }

          if (listing) {
            if (listing.clientCurrentListingLink !== undefined) {
              ob.clientCurrentListingLink = Array.isArray(listing.clientCurrentListingLink)
                ? JSON.stringify(listing.clientCurrentListingLink)
                : (listing.clientCurrentListingLink as unknown as string) ?? null;
            }
            if (listing.listingOwner !== undefined) ob.listingOwner = listing.listingOwner ?? null;
            if (listing.clientListingStatus !== undefined) ob.clientListingStatus = listing.clientListingStatus ?? null;
            if (listing.targetLiveDate !== undefined) ob.targetLiveDate = listing.targetLiveDate ?? null;
            if (listing.targetStartDate !== undefined) ob.targetStartDate = listing.targetStartDate ?? null;
            if (listing.targetDateNotes !== undefined) ob.targetDateNotes = listing.targetDateNotes ?? null;
            if (listing.upcomingReservations !== undefined) ob.upcomingReservations = listing.upcomingReservations ?? null;
          }

          if (photography) {
            if (photography.photographyCoverage !== undefined) ob.photographyCoverage = photography.photographyCoverage ?? null;
            if (photography.photographyNotes !== undefined) ob.photographyNotes = photography.photographyNotes ?? null;
          }

          ob.updatedBy = userId;
        }
        await this.propertyOnboardingRepo.save(ob);
      }

      // Refresh the property to get the latest data with relations
      const propertyId = property.id || clientProperty.id;
      const refreshed = await this.propertyRepo.findOne({ where: { id: propertyId }, relations: ["onboarding", "serviceInfo"] });
      updated.push({ clientProperty: refreshed!, serviceInfo: refreshed!.serviceInfo, onboarding: refreshed!.onboarding });
    }

    return { message: "Property pre-onboarding info updated", updated };
  }


  async saveOnboardingDetails(body: PropertyOnboardingRequest, userId: string) {
    const { clientId, clientProperties } = body;

    // Ensure client exists
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const results: Array<{ clientProperty: ClientPropertyEntity; onboarding: PropertyOnboarding; }> = [];

    for (const property of clientProperties) {
      let clientProperty: ClientPropertyEntity;

      if (property.id) {
        // Update existing property
        clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["onboarding", "client"] });
        if (!clientProperty) {
          throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
        }
        if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
          throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
        }
        clientProperty.address = property.address;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        clientProperty = await this.propertyRepo.save(clientProperty);
      } else {
        // Create new property
        clientProperty = this.propertyRepo.create({
          address: property.address,
          client: { id: clientId } as any,
          createdBy: userId,
          status: "draft",
        });
        clientProperty = await this.propertyRepo.save(clientProperty);
      }

      // Map Onboarding (sales, listing, photography) - no serviceInfo for internal onboarding
      const sales = property.onboarding?.sales;
      const listing = property.onboarding?.listing;
      const photography = property.onboarding?.photography;

      let onboardingEntity = clientProperty.onboarding;
      if (!onboardingEntity) {
        onboardingEntity = this.propertyOnboardingRepo.create({
          clientProperty,
          createdBy: userId,
        });
      }

      // Update onboarding fields
      if (sales) {
        if (sales.salesRepresentative !== undefined) onboardingEntity.salesRepresentative = sales.salesRepresentative ?? null;
        if (sales.salesNotes !== undefined) onboardingEntity.salesNotes = sales.salesNotes ?? null;
        if (sales.projectedRevenue !== undefined) onboardingEntity.projectedRevenue = sales.projectedRevenue != null ? String(sales.projectedRevenue) : null;
      }

      if (listing) {
        if (listing.clientCurrentListingLink !== undefined) {
          onboardingEntity.clientCurrentListingLink = Array.isArray(listing.clientCurrentListingLink)
            ? JSON.stringify(listing.clientCurrentListingLink)
            : (listing.clientCurrentListingLink as unknown as string) ?? null;
        }
        if (listing.listingOwner !== undefined) onboardingEntity.listingOwner = listing.listingOwner ?? null;
        if (listing.clientListingStatus !== undefined) onboardingEntity.clientListingStatus = listing.clientListingStatus ?? null;
        if (listing.targetLiveDate !== undefined) onboardingEntity.targetLiveDate = listing.targetLiveDate ?? null;
        if (listing.targetStartDate !== undefined) onboardingEntity.targetStartDate = listing.targetStartDate ?? null;
        if (listing.actualLiveDate !== undefined) onboardingEntity.actualLiveDate = listing.actualLiveDate ?? null;
        if (listing.actualStartDate !== undefined) onboardingEntity.actualStartDate = listing.actualStartDate ?? null;
        if (listing.targetDateNotes !== undefined) onboardingEntity.targetDateNotes = listing.targetDateNotes ?? null;
        if (listing.upcomingReservations !== undefined) onboardingEntity.upcomingReservations = listing.upcomingReservations ?? null;
      }

      if (photography) {
        if (photography.photographyCoverage !== undefined) onboardingEntity.photographyCoverage = photography.photographyCoverage ?? null;
        if (photography.photographyNotes !== undefined) onboardingEntity.photographyNotes = photography.photographyNotes ?? null;
      }

      onboardingEntity.updatedBy = userId;
      const savedOnboarding = await this.propertyOnboardingRepo.save(onboardingEntity);

      results.push({ clientProperty, onboarding: savedOnboarding });
    }

    return { message: "Internal onboarding details saved", results };
  }

  async updatedOnboardingDetails(body: PropertyOnboardingRequest, userId: string) {
    const { clientId, clientProperties } = body;

    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const updated: Array<{ clientProperty: ClientPropertyEntity; onboarding?: PropertyOnboarding | null; }> = [];

    // Proper update loop using id
    for (const property of clientProperties as Array<Property & { id: string; }>) {
      const clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["onboarding"] });
      if (!clientProperty) {
        throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
      }
      if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
        throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
      }

      if (property.address !== undefined) {
        clientProperty.address = property.address;
      }
      clientProperty.updatedAt = new Date();
      clientProperty.updatedBy = userId;
      await this.propertyRepo.save(clientProperty);

      // Update Onboarding if provided (no serviceInfo for internal onboarding)
      if (property.onboarding?.sales || property.onboarding?.listing || property.onboarding?.photography) {
        const sales = property.onboarding.sales;
        const listing = property.onboarding.listing;
        const photography = property.onboarding.photography;

        let ob = clientProperty.onboarding;
        if (!ob) {
          ob = this.propertyOnboardingRepo.create({ clientProperty, createdBy: userId });
        }

        if (sales) {
          if (sales.salesRepresentative !== undefined) ob.salesRepresentative = sales.salesRepresentative ?? null;
          if (sales.salesNotes !== undefined) ob.salesNotes = sales.salesNotes ?? null;
          if (sales.projectedRevenue !== undefined) ob.projectedRevenue = sales.projectedRevenue != null ? String(sales.projectedRevenue) : null;
        }

        if (listing) {
          if (listing.clientCurrentListingLink !== undefined) {
            ob.clientCurrentListingLink = Array.isArray(listing.clientCurrentListingLink)
              ? JSON.stringify(listing.clientCurrentListingLink)
              : (listing.clientCurrentListingLink as unknown as string) ?? null;
          }
          if (listing.listingOwner !== undefined) ob.listingOwner = listing.listingOwner ?? null;
          if (listing.clientListingStatus !== undefined) ob.clientListingStatus = listing.clientListingStatus ?? null;
          if (listing.targetLiveDate !== undefined) ob.targetLiveDate = listing.targetLiveDate ?? null;
          if (listing.targetStartDate !== undefined) ob.targetStartDate = listing.targetStartDate ?? null;
          if (listing.actualLiveDate !== undefined) ob.actualLiveDate = listing.actualLiveDate ?? null;
          if (listing.actualStartDate !== undefined) ob.actualStartDate = listing.actualStartDate ?? null;
          if (listing.targetDateNotes !== undefined) ob.targetDateNotes = listing.targetDateNotes ?? null;
          if (listing.upcomingReservations !== undefined) ob.upcomingReservations = listing.upcomingReservations ?? null;
        }

        if (photography) {
          if (photography.photographyCoverage !== undefined) ob.photographyCoverage = photography.photographyCoverage ?? null;
          if (photography.photographyNotes !== undefined) ob.photographyNotes = photography.photographyNotes ?? null;
        }

        ob.updatedBy = userId;
        await this.propertyOnboardingRepo.save(ob);
      }

      const refreshed = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["onboarding"] });
      updated.push({ clientProperty: refreshed!, onboarding: refreshed!.onboarding });
    }

    return { message: "Internal onboarding details updated", updated };
  }

  async getSalesRepresentativeList() {
    // find the distinct salesRepresentative from propertyOnboarding repo and return the list
    const rows = await this.propertyOnboardingRepo.createQueryBuilder("po")
      .select("DISTINCT po.salesRepresentative", "salesRepresentative")
      .where("po.salesRepresentative IS NOT NULL AND po.salesRepresentative != ''")
      .getRawMany();
    return rows.map(r => r.salesRepresentative);
  }

  async saveServiceInfo(body: any, userId: string) {
    const { clientId, clientProperties } = body as PropertyOnboardingRequest & { clientProperties: Array<Property & { id: string; }>; };
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const results: Array<{ clientProperty: ClientPropertyEntity; serviceInfo: PropertyServiceInfo; }> = [];

    for (const property of clientProperties) {
      const clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["serviceInfo", "client"] });
      if (!clientProperty) {
        throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
      }
      if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
        throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
      }

      if ((property as any).address !== undefined) {
        clientProperty.address = property.address;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      }

      const serviceInfoPayload = property.onboarding?.serviceInfo;
      if (!serviceInfoPayload) {
        throw CustomErrorHandler.validationError("serviceInfo payload is required");
      }

      let serviceInfoEntity = clientProperty.serviceInfo;
      if (!serviceInfoEntity) {
        serviceInfoEntity = this.propertyServiceInfoRepo.create({ clientProperty, createdBy: userId });
      }
      serviceInfoEntity.managementFee = serviceInfoPayload.managementFee != null ? String(serviceInfoPayload.managementFee) : null;
      serviceInfoEntity.serviceType = serviceInfoPayload.serviceType ?? null;
      serviceInfoEntity.contractLink = serviceInfoPayload.contractLink ?? null;
      serviceInfoEntity.serviceNotes = serviceInfoPayload.serviceNotes ?? null;
      serviceInfoEntity.updatedBy = userId;

      const savedServiceInfo = await this.propertyServiceInfoRepo.save(serviceInfoEntity);
      results.push({ clientProperty, serviceInfo: savedServiceInfo });
    }

    return { message: "Service info saved", results };
  }

  async updateServiceInfo(body: any, userId: string) {
    const { clientId, clientProperties } = body as PropertyOnboardingRequest;
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const updated: Array<{ clientProperty: ClientPropertyEntity; serviceInfo: PropertyServiceInfo | null; }> = [];

    for (const property of clientProperties as Array<Property & { id: string; }>) {
      const clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["serviceInfo", "client"] });
      if (!clientProperty) {
        throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
      }
      if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
        throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
      }

      if (property.address !== undefined) {
        clientProperty.address = property.address;
      }
      clientProperty.updatedAt = new Date();
      clientProperty.updatedBy = userId;
      await this.propertyRepo.save(clientProperty);

      const siPayload = property.onboarding?.serviceInfo;
      if (siPayload) {
        let si = clientProperty.serviceInfo;
        if (!si) {
          si = this.propertyServiceInfoRepo.create({ clientProperty, createdBy: userId });
        }
        if (siPayload.managementFee !== undefined) si.managementFee = siPayload.managementFee != null ? String(siPayload.managementFee) : null;
        if (siPayload.serviceType !== undefined) si.serviceType = siPayload.serviceType ?? null;
        if (siPayload.contractLink !== undefined) si.contractLink = siPayload.contractLink ?? null;
        if (siPayload.serviceNotes !== undefined) si.serviceNotes = siPayload.serviceNotes ?? null;
        si.updatedBy = userId;
        await this.propertyServiceInfoRepo.save(si);
      }

      const refreshed = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["serviceInfo"] });
      updated.push({ clientProperty: refreshed!, serviceInfo: refreshed!.serviceInfo ?? null });
    }

    return { message: "Service info updated", updated };
  }

  async getClientDetails(id: string) {
    return await this.clientRepo.findOne({
      where: { id },
      relations: [
        "properties",
        "secondaryContacts",
        "properties.onboarding",
        "properties.serviceInfo",
        "properties.propertyInfo",
        "properties.propertyInfo.propertyBedTypes",
        "properties.propertyInfo.propertyBathroomLocation",
        "properties.propertyInfo.propertyUpsells",
        "properties.propertyInfo.propertyParkingInfo",
        "properties.propertyInfo.vendorManagementInfo",
        "properties.propertyInfo.vendorManagementInfo.suppliesToRestock",
        "properties.propertyInfo.vendorManagementInfo.vendorInfo",
      ],
    });
  }

  async saveListingInfo(body: any, userId: string) {
    const { clientId, clientProperties } = body as PropertyOnboardingRequest & { clientProperties: Array<Property & { id: string; }>; };
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const results: Array<{ clientProperty: ClientPropertyEntity; propertyInfo: PropertyInfo; }> = [];

    for (const property of clientProperties) {
      const clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["propertyInfo", "client"] });
      if (!clientProperty) {
        throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
      }
      if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
        throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
      }

      if ((property as any).address !== undefined) {
        clientProperty.address = property.address;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      }

      const listingPayload = property.onboarding?.listing;
      if (!listingPayload) {
        throw CustomErrorHandler.validationError("listing payload is required");
      }

      let propertyInfo = clientProperty.propertyInfo;
      if (!propertyInfo) {
        propertyInfo = this.propertyInfoRepo.create({ clientProperty, createdBy: userId });
      }

      // Map all listing fields to propertyInfo
      this.mapListingFieldsToPropertyInfo(propertyInfo, listingPayload);
      propertyInfo.updatedBy = userId;
      const savedPropertyInfo = await this.propertyInfoRepo.save(propertyInfo);

      // Handle PropertyBedTypes
      if (listingPayload.propertyBedTypes && listingPayload.propertyBedTypes.length > 0) {
        await this.handlePropertyBedTypes(savedPropertyInfo, listingPayload.propertyBedTypes);
      }

      // Handle PropertyUpsells
      if (listingPayload.propertyUpsells && listingPayload.propertyUpsells.length > 0) {
        await this.handlePropertyUpsells(savedPropertyInfo, listingPayload.propertyUpsells);
      }

      results.push({ clientProperty, propertyInfo: savedPropertyInfo });
    }

    return { message: "Listing info saved", results };
  }

  async updateListingInfo(body: any, userId: string) {
    const { clientId, clientProperties } = body as PropertyOnboardingRequest & { clientProperties: Array<Property & { id: string; }>; };
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const updated: Array<{ clientProperty: ClientPropertyEntity; propertyInfo: PropertyInfo | null; }> = [];

    for (const property of clientProperties) {
      const clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["propertyInfo", "client"] });
      if (!clientProperty) {
        throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
      }
      if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
        throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
      }

      if ((property as any).address !== undefined) {
        clientProperty.address = property.address;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      }

      const listingPayload = property.onboarding?.listing;
      if (listingPayload) {
        let propertyInfo = clientProperty.propertyInfo;
        if (!propertyInfo) {
          propertyInfo = this.propertyInfoRepo.create({ clientProperty, createdBy: userId });
        }

        // Map all listing fields to propertyInfo
        this.mapListingFieldsToPropertyInfo(propertyInfo, listingPayload);
        propertyInfo.updatedBy = userId;
        await this.propertyInfoRepo.save(propertyInfo);

        // Handle PropertyBedTypes
        if (listingPayload.propertyBedTypes && listingPayload.propertyBedTypes.length > 0) {
          await this.handlePropertyBedTypes(propertyInfo, listingPayload.propertyBedTypes);
        }

        // Handle PropertyUpsells
        if (listingPayload.propertyUpsells && listingPayload.propertyUpsells.length > 0) {
          await this.handlePropertyUpsells(propertyInfo, listingPayload.propertyUpsells);
        }

        // Handle Parking Info (array of parking rows)
        if (listingPayload.parking !== undefined) {
          await this.handlePropertyParkingInfo(propertyInfo, Array.isArray(listingPayload.parking) ? listingPayload.parking : []);
        }

        // Handle Bathroom Locations
        if (listingPayload.propertyBathroomLocation !== undefined) {
          await this.handlePropertyBathroomLocation(propertyInfo, listingPayload.propertyBathroomLocation ?? []);
        }

        // Handle Vendor Management
        if (listingPayload.vendorManagement) {
          await this.handleVendorManagementInfo(propertyInfo, listingPayload.vendorManagement);
        }
      }

      const refreshed = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["propertyInfo"] });
      updated.push({ clientProperty: refreshed!, propertyInfo: refreshed!.propertyInfo ?? null });
    }

    return { message: "Listing info updated", updated };
  }

  private mapListingFieldsToPropertyInfo(propertyInfo: PropertyInfo, listingPayload: any) {
    // Listing Name
    if (listingPayload.internalListingName !== undefined) propertyInfo.internalListingName = listingPayload.internalListingName ?? null;
    if (listingPayload.externalListingName !== undefined) propertyInfo.externalListingName = listingPayload.externalListingName ?? null;

    // General info
    if (listingPayload.propertyTypeId !== undefined) propertyInfo.propertyTypeId = listingPayload.propertyTypeId ?? null;
    if (listingPayload.noOfFloors !== undefined) propertyInfo.noOfFloors = listingPayload.noOfFloors ?? null;
    if (listingPayload.squareMeters !== undefined) propertyInfo.squareMeters = listingPayload.squareMeters ?? null;
    if (listingPayload.personCapacity !== undefined) propertyInfo.personCapacity = listingPayload.personCapacity ?? null;

    // Bedrooms
    if (listingPayload.roomType !== undefined) propertyInfo.roomType = listingPayload.roomType ?? null;
    if (listingPayload.bedroomsNumber !== undefined) propertyInfo.bedroomsNumber = listingPayload.bedroomsNumber ?? null;

    // Bathrooms
    if (listingPayload.bathroomType !== undefined) propertyInfo.bathroomType = listingPayload.bathroomType ?? null;
    if (listingPayload.bathroomsNumber !== undefined) propertyInfo.bathroomsNumber = listingPayload.bathroomsNumber ?? null;
    if (listingPayload.guestBathroomsNumber !== undefined) propertyInfo.guestBathroomsNumber = listingPayload.guestBathroomsNumber ?? null;

    // Listing Information
    if (listingPayload.checkInTimeStart !== undefined) propertyInfo.checkInTimeStart = listingPayload.checkInTimeStart ?? null;
    if (listingPayload.checkOutTime !== undefined) propertyInfo.checkOutTime = listingPayload.checkOutTime ?? null;
    if (listingPayload.canAnyoneBookAnytime !== undefined) propertyInfo.canAnyoneBookAnytime = listingPayload.canAnyoneBookAnytime ?? null;
    if (listingPayload.bookingAcceptanceNoticeNotes !== undefined) propertyInfo.bookingAcceptanceNoticeNotes = listingPayload.bookingAcceptanceNoticeNotes ?? null;

    // House Rules
    if (listingPayload.allowPartiesAndEvents !== undefined) propertyInfo.allowPartiesAndEvents = listingPayload.allowPartiesAndEvents ?? null;
    if (listingPayload.allowSmoking !== undefined) propertyInfo.allowSmoking = listingPayload.allowSmoking ?? null;
    if (listingPayload.allowPets !== undefined) propertyInfo.allowPets = listingPayload.allowPets ?? null;
    if (listingPayload.petFee !== undefined) propertyInfo.petFee = listingPayload.petFee ?? null;
    if (listingPayload.numberOfPetsAllowed !== undefined) propertyInfo.numberOfPetsAllowed = listingPayload.numberOfPetsAllowed ?? null;
    if (listingPayload.petRestrictionsNotes !== undefined) propertyInfo.petRestrictionsNotes = listingPayload.petRestrictionsNotes ?? null;
    if (listingPayload.allowChildreAndInfants !== undefined) propertyInfo.allowChildreAndInfants = listingPayload.allowChildreAndInfants ?? null;
    if (listingPayload.childrenInfantsRestrictionReason !== undefined) propertyInfo.childrenInfantsRestrictionReason = listingPayload.childrenInfantsRestrictionReason ?? null;
    if (listingPayload.allowLuggageDropoffBeforeCheckIn !== undefined) propertyInfo.allowLuggageDropoffBeforeCheckIn = listingPayload.allowLuggageDropoffBeforeCheckIn ?? null;
    if (listingPayload.otherHouseRules !== undefined) propertyInfo.otherHouseRules = listingPayload.otherHouseRules ?? null;

    // Parking (instructions only; types/fee/spots handled via PropertyParkingInfo)
    if (listingPayload.parkingInstructions !== undefined) propertyInfo.parkingInstructions = listingPayload.parkingInstructions ?? null;

    // Property Access
    if (listingPayload.checkInProcess !== undefined) propertyInfo.checkInProcess = listingPayload.checkInProcess ?? null;
    if (listingPayload.doorLockType !== undefined) propertyInfo.doorLockType = listingPayload.doorLockType ?? null;
    if (listingPayload.doorLockCodeType !== undefined) propertyInfo.doorLockCodeType = listingPayload.doorLockCodeType ?? null;
    if (listingPayload.codeResponsibleParty !== undefined) propertyInfo.codeResponsibleParty = listingPayload.codeResponsibleParty ?? null;
    if (listingPayload.responsibilityToSetDoorCodes !== undefined) propertyInfo.responsibilityToSetDoorCodes = listingPayload.responsibilityToSetDoorCodes ?? null;
    if (listingPayload.standardDoorCode !== undefined) propertyInfo.standardDoorCode = listingPayload.standardDoorCode ?? null;
    if (listingPayload.doorLockAppName !== undefined) propertyInfo.doorLockAppName = listingPayload.doorLockAppName ?? null;
    if (listingPayload.doorLockAppUsername !== undefined) propertyInfo.doorLockAppUsername = listingPayload.doorLockAppUsername ?? null;
    if (listingPayload.doorLockAppPassword !== undefined) propertyInfo.doorLockAppPassword = listingPayload.doorLockAppPassword ?? null;
    if (listingPayload.lockboxLocation !== undefined) propertyInfo.lockboxLocation = listingPayload.lockboxLocation ?? null;
    if (listingPayload.lockboxCode !== undefined) propertyInfo.lockboxCode = listingPayload.lockboxCode ?? null;
    if (listingPayload.doorLockInstructions !== undefined) propertyInfo.doorLockInstructions = listingPayload.doorLockInstructions ?? null;

    // Waste Management
    if (listingPayload.wasteCollectionDays !== undefined) propertyInfo.wasteCollectionDays = listingPayload.wasteCollectionDays ?? null;
    if (listingPayload.wasteBinLocation !== undefined) propertyInfo.wasteBinLocation = listingPayload.wasteBinLocation ?? null;
    if (listingPayload.wasteManagementInstructions !== undefined) propertyInfo.wasteManagementInstructions = listingPayload.wasteManagementInstructions ?? null;

    // Additional Services/Upsells
    if (listingPayload.additionalServiceNotes !== undefined) propertyInfo.additionalServiceNotes = listingPayload.additionalServiceNotes ?? null;

    if (listingPayload.checkInInstructions !== undefined) propertyInfo.checkInInstructions = listingPayload.checkInInstructions ?? null;
    if (listingPayload.checkOutInstructions !== undefined) propertyInfo.checkOutInstructions = listingPayload.checkOutInstructions ?? null;

    //Management
    if (listingPayload.specialInstructions !== undefined) propertyInfo.specialInstructions = listingPayload.specialInstructions ?? null;
    if (listingPayload.leadTimeDays !== undefined) propertyInfo.leadTimeDays = listingPayload.leadTimeDays ?? null;
    if (listingPayload.bookingAcceptanceNotes !== undefined) propertyInfo.bookingAcceptanceNotes = listingPayload.bookingAcceptanceNotes ?? null;
    if (listingPayload.managementNotes !== undefined) propertyInfo.managementNotes = listingPayload.managementNotes ?? null;

    //Financials
    if (listingPayload.minPrice !== undefined) propertyInfo.minPrice = listingPayload.minPrice ?? null;
    if (listingPayload.minNights !== undefined) propertyInfo.minNights = listingPayload.minNights ?? null;
    if (listingPayload.maxNights !== undefined) propertyInfo.maxNights = listingPayload.maxNights ?? null;
    if (listingPayload.propertyLicenseNumber !== undefined) propertyInfo.propertyLicenseNumber = listingPayload.propertyLicenseNumber ?? null;
    if (listingPayload.tax !== undefined) propertyInfo.tax = listingPayload.tax ?? null;
    if (listingPayload.financialNotes !== undefined) propertyInfo.financialNotes = listingPayload.financialNotes ?? null;

    // Amenities
    if (listingPayload.amenities !== undefined) propertyInfo.amenities = listingPayload.amenities ?? null;
    if (listingPayload.wifiUsername !== undefined) propertyInfo.wifiUsername = listingPayload.wifiUsername ?? null;
    if (listingPayload.wifiPassword !== undefined) propertyInfo.wifiPassword = listingPayload.wifiPassword ?? null;
    if (listingPayload.wifiSpeed !== undefined) propertyInfo.wifiSpeed = listingPayload.wifiSpeed ?? null;
    if (listingPayload.locationOfModem !== undefined) propertyInfo.locationOfModem = listingPayload.locationOfModem ?? null;
    if (listingPayload.swimmingPoolNotes !== undefined) propertyInfo.swimmingPoolNotes = listingPayload.swimmingPoolNotes ?? null;
    if (listingPayload.hotTubInstructions !== undefined) propertyInfo.hotTubInstructions = listingPayload.hotTubInstructions ?? null;
    if (listingPayload.firePlaceNotes !== undefined) propertyInfo.firePlaceNotes = listingPayload.firePlaceNotes ?? null;
    if (listingPayload.firepitNotes !== undefined) propertyInfo.firepitNotes = listingPayload.firepitNotes ?? null;
    if (listingPayload.heatControlInstructions !== undefined) propertyInfo.heatControlInstructions = listingPayload.heatControlInstructions ?? null;
    if (listingPayload.locationOfThemostat !== undefined) propertyInfo.locationOfThemostat = listingPayload.locationOfThemostat ?? null;
  }

  private async handlePropertyBedTypes(propertyInfo: PropertyInfo, bedTypesData: any[]) {
    // Get existing bed types for this property
    const existingBedTypes = await this.propertyBedTypesRepo.find({
      where: { propertyId: { id: propertyInfo.id } }
    });
    const existingBedTypeIds = existingBedTypes.map(bt => bt.id);
    const incomingBedTypeIds = bedTypesData.map(bt => bt.id).filter(id => id !== undefined);

    // Remove bed types that are not in the incoming list
    const bedTypesToDelete = existingBedTypes.filter(bt => !incomingBedTypeIds.includes(bt.id));
    if (bedTypesToDelete.length > 0) {
      await this.propertyBedTypesRepo.remove(bedTypesToDelete);
    }

    // Process each bed type in the incoming data
    for (const bedTypeData of bedTypesData) {
      if (bedTypeData.id && existingBedTypeIds.includes(bedTypeData.id)) {
        // Update existing bed type
        const existingBedType = existingBedTypes.find(bt => bt.id === bedTypeData.id);
        if (existingBedType) {
          if (bedTypeData.floorLevel !== undefined) existingBedType.floorLevel = Number(bedTypeData.floorLevel);
          if (bedTypeData.bedroomNumber !== undefined) existingBedType.bedroomNumber = bedTypeData.bedroomNumber;
          if (bedTypeData.bedTypeId !== undefined) existingBedType.bedTypeId = bedTypeData.bedTypeId;
          if (bedTypeData.quantity !== undefined) existingBedType.quantity = bedTypeData.quantity;
          await this.propertyBedTypesRepo.save(existingBedType);
        }
      } else {
        // Create new bed type
        const newBedType = this.propertyBedTypesRepo.create({
          floorLevel: Number(bedTypeData.floorLevel),
          bedroomNumber: bedTypeData.bedroomNumber,
          bedTypeId: bedTypeData.bedTypeId,
          quantity: bedTypeData.quantity,
          propertyId: propertyInfo
        });
        await this.propertyBedTypesRepo.save(newBedType);
      }
    }
  }

  private async handlePropertyUpsells(propertyInfo: PropertyInfo, upsellsData: any[]) {
    // Get existing upsells for this property
    const existingUpsells = await this.propertyUpsellsRepo.find({
      where: { propertyId: { id: propertyInfo.id } }
    });
    const existingUpsellIds = existingUpsells.map(u => u.id);
    const incomingUpsellIds = upsellsData.map(u => u.id).filter(id => id !== undefined);

    // Remove upsells that are not in the incoming list
    const upsellsToDelete = existingUpsells.filter(u => !incomingUpsellIds.includes(u.id));
    if (upsellsToDelete.length > 0) {
      await this.propertyUpsellsRepo.remove(upsellsToDelete);
    }

    // Process each upsell in the incoming data
    for (const upsellData of upsellsData) {
      if (upsellData.id && existingUpsellIds.includes(upsellData.id)) {
        // Update existing upsell
        const existingUpsell = existingUpsells.find(u => u.id === upsellData.id);
        if (existingUpsell) {
          if (upsellData.upsellName !== undefined) existingUpsell.upsellName = upsellData.upsellName;
          if (upsellData.allowUpsell !== undefined) existingUpsell.allowUpsell = upsellData.allowUpsell;
          if (upsellData.feeType !== undefined) existingUpsell.feeType = upsellData.feeType;
          if (upsellData.fee !== undefined) existingUpsell.fee = upsellData.fee;
          if (upsellData.maxAdditionalHours !== undefined) existingUpsell.maxAdditionalHours = upsellData.maxAdditionalHours;
          await this.propertyUpsellsRepo.save(existingUpsell);
        }
      } else {
        // Create new upsell
        const newUpsell = this.propertyUpsellsRepo.create({
          upsellName: upsellData.upsellName,
          allowUpsell: upsellData.allowUpsell,
          feeType: upsellData.feeType,
          fee: upsellData.fee,
          maxAdditionalHours: upsellData.maxAdditionalHours,
          propertyId: propertyInfo
        });
        await this.propertyUpsellsRepo.save(newUpsell);
      }
    }
  }

  private async handlePropertyParkingInfo(propertyInfo: PropertyInfo, parkingRows: any[]) {
    const existing = await this.propertyParkingInfoRepo.find({ where: { propertyId: { id: propertyInfo.id } } });
    const existingById = new Map(existing.map(r => [r.id, r] as const));
    const existingByType = new Map(existing.map(r => [(r as any).parkingType, r] as const));
    const incomingIds = new Set<number>();

    // If array empty, clear all
    if (Array.isArray(parkingRows) && parkingRows.length === 0) {
      if (existing.length > 0) await this.propertyParkingInfoRepo.remove(existing);
      return;
    }

    for (const p of parkingRows || []) {
      let row = (p.id && existingById.has(p.id))
        ? existingById.get(p.id)!
        : (existingByType.get(p.parkingType) ?? this.propertyParkingInfoRepo.create({ propertyId: propertyInfo }));

      (row as any).parkingType = p.parkingType;
      if (p.parkingFee !== undefined) row.parkingFee = p.parkingFee ?? null as any;
      if (p.numberOfParkingSpots !== undefined) row.numberOfParkingSpots = p.numberOfParkingSpots ?? null as any;
      row = await this.propertyParkingInfoRepo.save(row);
      incomingIds.add(row.id);
    }

    const toDelete = existing.filter(e => !incomingIds.has(e.id));
    if (toDelete.length > 0) {
      await this.propertyParkingInfoRepo.remove(toDelete);
    }
  }

  private async handleVendorManagementInfo(propertyInfo: PropertyInfo, vendorPayload: any) {
    // Load existing VM with children
    let vm = await this.propertyVendorManagementRepo.findOne({ where: { propertyInfo: { id: propertyInfo.id } }, relations: ["suppliesToRestock", "vendorInfo"] });
    if (!vm) {
      vm = this.propertyVendorManagementRepo.create({ propertyInfo });
    }

    // Cleaner
    if (vendorPayload.cleanerManagedBy !== undefined) vm.cleanerManagedBy = vendorPayload.cleanerManagedBy ?? null;
    if (vendorPayload.cleanerManagedByReason !== undefined) vm.cleanerManagedByReason = vendorPayload.cleanerManagedByReason ?? null;
    if (vendorPayload.hasCurrentCleaner !== undefined) vm.hasCurrentCleaner = vendorPayload.hasCurrentCleaner ?? null;
    if (vendorPayload.cleaningFee !== undefined) vm.cleaningFee = vendorPayload.cleaningFee ?? null;
    if (vendorPayload.cleanerName !== undefined) vm.cleanerName = vendorPayload.cleanerName ?? null;
    if (vendorPayload.cleanerPhone !== undefined) vm.cleanerPhone = vendorPayload.cleanerPhone ?? null;
    if (vendorPayload.cleanerEmail !== undefined) vm.cleanerEmail = vendorPayload.cleanerEmail ?? null;
    if (vendorPayload.acknowledgeCleanerResponsibility !== undefined) vm.acknowledgeCleanerResponsibility = vendorPayload.acknowledgeCleanerResponsibility ?? null;
    if (vendorPayload.acknowledgeCleanerResponsibilityReason !== undefined) vm.acknowledgeCleanerResponsibilityReason = vendorPayload.acknowledgeCleanerResponsibilityReason ?? null;
    if (vendorPayload.ensureCleanersScheduled !== undefined) vm.ensureCleanersScheduled = vendorPayload.ensureCleanersScheduled ?? null;
    if (vendorPayload.ensureCleanersScheduledReason !== undefined) vm.ensureCleanersScheduledReason = vendorPayload.ensureCleanersScheduledReason ?? null;
    if (vendorPayload.propertyCleanedBeforeNextCheckIn !== undefined) vm.propertyCleanedBeforeNextCheckIn = vendorPayload.propertyCleanedBeforeNextCheckIn ?? null;
    if (vendorPayload.propertyCleanedBeforeNextCheckInReason !== undefined) vm.propertyCleanedBeforeNextCheckInReason = vendorPayload.propertyCleanedBeforeNextCheckInReason ?? null;
    if (vendorPayload.luxuryLodgingReadyAssumption !== undefined) vm.luxuryLodgingReadyAssumption = vendorPayload.luxuryLodgingReadyAssumption ?? null;
    if (vendorPayload.luxuryLodgingReadyAssumptionReason !== undefined) vm.luxuryLodgingReadyAssumptionReason = vendorPayload.luxuryLodgingReadyAssumptionReason ?? null;
    if (vendorPayload.cleaningTurnoverNotes !== undefined) vm.cleaningTurnoverNotes = vendorPayload.cleaningTurnoverNotes ?? null;

    // Restocking supplies policy
    if (vendorPayload.restockingSuppliesManagedBy !== undefined) vm.restockingSuppliesManagedBy = vendorPayload.restockingSuppliesManagedBy ?? null;
    if (vendorPayload.restockingSuppliesManagedByReason !== undefined) vm.restockingSuppliesManagedByReason = vendorPayload.restockingSuppliesManagedByReason ?? null;
    if (vendorPayload.luxuryLodgingRestockWithoutApproval !== undefined) vm.luxuryLodgingRestockWithoutApproval = vendorPayload.luxuryLodgingRestockWithoutApproval ?? null;
    if (vendorPayload.luxuryLodgingConfirmBeforePurchase !== undefined) vm.luxuryLodgingConfirmBeforePurchase = vendorPayload.luxuryLodgingConfirmBeforePurchase ?? null;

    // Other
    if (vendorPayload.addtionalVendorManagementNotes !== undefined) vm.addtionalVendorManagementNotes = vendorPayload.addtionalVendorManagementNotes ?? null;
    if (vendorPayload.acknowledgeExpensesBilledToStatement !== undefined) vm.acknowledgeExpensesBilledToStatement = vendorPayload.acknowledgeExpensesBilledToStatement as any;

    // Save base VM first
    vm = await this.propertyVendorManagementRepo.save(vm);

    // Supplies To Restock
    if (Array.isArray(vendorPayload.suppliesToRestock)) {
      const existing = await this.suppliesToRestockRepo.find({ where: { propertyVendorManagementId: { id: vm.id } } });
      const existingById = new Map(existing.map(s => [s.id, s] as const));
      const incomingIds = new Set<number>();

      for (const s of vendorPayload.suppliesToRestock) {
        let row: SuppliesToRestock;
        if (s.id && existingById.has(s.id)) {
          row = existingById.get(s.id)!;
        } else {
          row = this.suppliesToRestockRepo.create({ propertyVendorManagementId: vm });
        }
        if (s.supplyName !== undefined) row.supplyName = s.supplyName;
        if (s.notes !== undefined) row.notes = s.notes ?? null;
        row = await this.suppliesToRestockRepo.save(row);
        incomingIds.add(row.id);
      }

      // delete removed
      const toDelete = existing.filter(e => !incomingIds.has(e.id));
      if (toDelete.length > 0) {
        await this.suppliesToRestockRepo.remove(toDelete);
      }
    }

    // Vendor Info
    if (Array.isArray(vendorPayload.vendorInfo)) {
      const existing = await this.vendorInfoRepo.find({ where: { propertyVendorManagementId: { id: vm.id } } });
      const existingById = new Map(existing.map(v => [v.id, v] as const));
      const incomingIds = new Set<number>();

      for (const v of vendorPayload.vendorInfo) {
        let row: VendorInfo;
        if (v.id && existingById.has(v.id)) {
          row = existingById.get(v.id)!;
        } else {
          row = this.vendorInfoRepo.create({ propertyVendorManagementId: vm });
        }
        if (v.workCategory !== undefined) row.workCategory = v.workCategory ?? null;
        if (v.managedBy !== undefined) row.managedBy = v.managedBy ?? null;
        if (v.name !== undefined) row.name = v.name ?? null;
        if (v.contact !== undefined) row.contact = v.contact ?? null;
        if (v.email !== undefined) row.email = v.email ?? null;
        if (v.scheduleType !== undefined) row.scheduleType = v.scheduleType ?? null;
        if (v.intervalMonth !== undefined) row.intervalMonth = v.intervalMonth ?? null;
        if (v.dayOfWeek !== undefined) row.dayOfWeek = JSON.stringify(v.dayOfWeek) ?? null as any;
        if (v.weekOfMonth !== undefined) row.weekOfMonth = v.weekOfMonth ?? null;
        if (v.dayOfMonth !== undefined) row.dayOfMonth = v.dayOfMonth ?? null;
        if (v.notes !== undefined) row.notes = v.notes ?? null;
        row = await this.vendorInfoRepo.save(row);
        incomingIds.add(row.id);
      }

      const toDelete = existing.filter(e => !incomingIds.has(e.id));
      if (toDelete.length > 0) {
        await this.vendorInfoRepo.remove(toDelete);
      }
    }
  }

  private async handlePropertyBathroomLocation(propertyInfo: PropertyInfo, bathroomsData: any[]) {
    // Fetch existing
    const existing = await this.propertyBathroomLocationRepo.find({ where: { propertyId: { id: propertyInfo.id } } });
    const existingById = new Map(existing.map(b => [b.id, b] as const));
    const incomingIds = new Set<number>();

    for (const b of bathroomsData || []) {
      let row = b.id && existingById.has(b.id) ? existingById.get(b.id)! : this.propertyBathroomLocationRepo.create({ propertyId: propertyInfo });
      if (b.floorLevel !== undefined) row.floorLevel = b.floorLevel ?? null;
      if (b.bathroomType !== undefined) row.bathroomType = b.bathroomType ?? null;
      if (b.bathroomNumber !== undefined) row.bathroomNumber = b.bathroomNumber ?? null;
      if (b.ensuite !== undefined) row.ensuite = b.ensuite ?? null;
      row = await this.propertyBathroomLocationRepo.save(row);
      incomingIds.add(row.id);
    }

    // delete removed
    const toDelete = existing.filter(e => !incomingIds.has(e.id));
    if (toDelete.length > 0) {
      await this.propertyBathroomLocationRepo.remove(toDelete);
    }
  }


  async saveOnboardingDetailsClientForm(body: any, userId: string) {
    const { clientId, clientProperties } = body as PropertyOnboardingRequest & { clientProperties: Array<Property & { id?: string; }>; };
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const results: Array<{ clientProperty: ClientPropertyEntity; onboarding: PropertyOnboarding; }> = [];

    for (const property of clientProperties) {
      let clientProperty: ClientPropertyEntity;

      if (property.id) {
        // Update existing property
        clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["onboarding", "client"] });
        if (!clientProperty) {
          throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
        }
        if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
          throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
        }
        clientProperty.address = property.address;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      } else {
        // Create new property
        clientProperty = this.propertyRepo.create({
          address: property.address,
          client: { id: clientId } as any,
          createdBy: userId,
          status: "draft",
        });
        clientProperty = await this.propertyRepo.save(clientProperty);
      }

      const listingPayload = property.onboarding?.listing;
      if (!listingPayload) {
        throw CustomErrorHandler.validationError("listing payload is required");
      }

      let onboarding = clientProperty.onboarding;
      if (!onboarding) {
        onboarding = this.propertyOnboardingRepo.create({ clientProperty, createdBy: userId });
      }

      // Map client-facing onboarding fields
      if (listingPayload.targetLiveDate !== undefined) onboarding.targetLiveDate = listingPayload.targetLiveDate ?? null;
      if (listingPayload.targetStartDate !== undefined) onboarding.targetStartDate = listingPayload.targetStartDate ?? null;
      if (listingPayload.upcomingReservations !== undefined) onboarding.upcomingReservations = listingPayload.upcomingReservations ?? null;

      // Store client-facing specific fields in targetDateNotes as JSON
      const clientFormData = {
        acknowledgePropertyReadyByStartDate: listingPayload.acknowledgePropertyReadyByStartDate ?? null,
        agreesUnpublishExternalListings: listingPayload.agreesUnpublishExternalListings ?? null,
        externalListingNotes: listingPayload.externalListingNotes ?? null,
        acknowledgesResponsibilityToInform: listingPayload.acknowledgesResponsibilityToInform ?? null,
      };
      onboarding.targetDateNotes = JSON.stringify(clientFormData);

      onboarding.updatedBy = userId;
      const savedOnboarding = await this.propertyOnboardingRepo.save(onboarding);

      results.push({ clientProperty, onboarding: savedOnboarding });
    }

    return { message: "Client onboarding details saved", results };
  }

  async updateOnboardingDetailsClientForm(body: any, userId: string) {
    const { clientId, clientProperties } = body as PropertyOnboardingRequest & { clientProperties: Array<Property & { id?: string; }>; };
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const updated: Array<{ clientProperty: ClientPropertyEntity; onboarding?: PropertyOnboarding | null; }> = [];

    for (const property of clientProperties) {
      let clientProperty: ClientPropertyEntity;

      if (property.id) {
        // Update existing property
        clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["onboarding", "client"] });
        if (!clientProperty) {
          throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
        }
        if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
          throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
        }

        if ((property as any).address !== undefined) {
          clientProperty.address = property.address;
          clientProperty.updatedAt = new Date();
          clientProperty.updatedBy = userId;
          await this.propertyRepo.save(clientProperty);
        }
      } else {
        // Create new property
        clientProperty = this.propertyRepo.create({
          address: property.address,
          client: { id: clientId } as any,
          createdBy: userId,
          status: "draft",
        });
        clientProperty = await this.propertyRepo.save(clientProperty);
      }

      const listingPayload = property.onboarding?.listing;
      if (listingPayload) {
        let onboarding = clientProperty.onboarding;
        if (!onboarding) {
          onboarding = this.propertyOnboardingRepo.create({ clientProperty, createdBy: userId });
        }

        // Map client-facing onboarding fields
        if (listingPayload.targetLiveDate !== undefined) onboarding.targetLiveDate = listingPayload.targetLiveDate ?? null;
        if (listingPayload.targetStartDate !== undefined) onboarding.targetStartDate = listingPayload.targetStartDate ?? null;
        if (listingPayload.upcomingReservations !== undefined) onboarding.upcomingReservations = listingPayload.upcomingReservations ?? null;

        // Store client-facing specific fields in targetDateNotes as JSON
        const clientFormData = {
          acknowledgePropertyReadyByStartDate: listingPayload.acknowledgePropertyReadyByStartDate ?? null,
          agreesUnpublishExternalListings: listingPayload.agreesUnpublishExternalListings ?? null,
          externalListingNotes: listingPayload.externalListingNotes ?? null,
          acknowledgesResponsibilityToInform: listingPayload.acknowledgesResponsibilityToInform ?? null,
        };
        onboarding.targetDateNotes = JSON.stringify(clientFormData);

        onboarding.updatedBy = userId;
        await this.propertyOnboardingRepo.save(onboarding);
      }

      const refreshed = await this.propertyRepo.findOne({ where: { id: clientProperty.id }, relations: ["onboarding"] });
      updated.push({ clientProperty: refreshed!, onboarding: refreshed!.onboarding });
    }

    return { message: "Client onboarding details updated", updated };
  }

  async saveListingDetailsClientForm(body: any, userId: string) {
    const { clientId, clientProperties } = body as PropertyOnboardingRequest & { clientProperties: Array<Property & { id: string; }>; };
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const results: Array<{ clientProperty: ClientPropertyEntity; serviceInfo: PropertyServiceInfo; propertyInfo: PropertyInfo; }> = [];

    for (const property of clientProperties) {
      const clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["serviceInfo", "propertyInfo", "client"] });
      if (!clientProperty) {
        throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
      }
      if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
        throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
      }

      if ((property as any).address !== undefined) {
        clientProperty.address = property.address;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      }

      const serviceInfoPayload = property.onboarding?.serviceInfo;
      const listingPayload = property.onboarding?.listing;

      if (!serviceInfoPayload || !listingPayload) {
        throw CustomErrorHandler.validationError("serviceInfo and listing payloads are required");
      }

      // Handle Service Info
      let serviceInfo = clientProperty.serviceInfo;
      if (!serviceInfo) {
        serviceInfo = this.propertyServiceInfoRepo.create({ clientProperty, createdBy: userId });
      }
      serviceInfo.managementFee = serviceInfoPayload.managementFee != null ? String(serviceInfoPayload.managementFee) : null;
      serviceInfo.serviceType = serviceInfoPayload.serviceType ?? null;
      serviceInfo.updatedBy = userId;
      const savedServiceInfo = await this.propertyServiceInfoRepo.save(serviceInfo);

      // Handle Property Info
      let propertyInfo = clientProperty.propertyInfo;
      if (!propertyInfo) {
        propertyInfo = this.propertyInfoRepo.create({ clientProperty, createdBy: userId });
      }

      // Map all listing fields to propertyInfo
      this.mapListingFieldsToPropertyInfo(propertyInfo, listingPayload);
      propertyInfo.updatedBy = userId;
      const savedPropertyInfo = await this.propertyInfoRepo.save(propertyInfo);

      // Handle PropertyBedTypes
      if (listingPayload.propertyBedTypes && listingPayload.propertyBedTypes.length > 0) {
        await this.handlePropertyBedTypes(savedPropertyInfo, listingPayload.propertyBedTypes);
      }

      // Handle PropertyUpsells
      if (listingPayload.propertyUpsells && listingPayload.propertyUpsells.length > 0) {
        await this.handlePropertyUpsells(savedPropertyInfo, listingPayload.propertyUpsells);
      }

      results.push({ clientProperty, serviceInfo: savedServiceInfo, propertyInfo: savedPropertyInfo });
    }

    return { message: "Client listing details saved", results };
  }

  async updateListingDetailsClientForm(body: any, userId: string) {
    const { clientId, clientProperties } = body as PropertyOnboardingRequest & { clientProperties: Array<Property & { id: string; }>; };
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const updated: Array<{ clientProperty: ClientPropertyEntity; serviceInfo: PropertyServiceInfo | null; propertyInfo: PropertyInfo | null; }> = [];

    for (const property of clientProperties) {
      const clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["serviceInfo", "propertyInfo", "client"] });
      if (!clientProperty) {
        throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
      }
      if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
        throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
      }

      if ((property as any).address !== undefined) {
        clientProperty.address = property.address;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      }

      const serviceInfoPayload = property.onboarding?.serviceInfo;
      const listingPayload = property.onboarding?.listing;

      // Handle Service Info
      if (serviceInfoPayload) {
        let serviceInfo = clientProperty.serviceInfo;
        if (!serviceInfo) {
          serviceInfo = this.propertyServiceInfoRepo.create({ clientProperty, createdBy: userId });
        }
        if (serviceInfoPayload.managementFee !== undefined) serviceInfo.managementFee = serviceInfoPayload.managementFee != null ? String(serviceInfoPayload.managementFee) : null;
        if (serviceInfoPayload.serviceType !== undefined) serviceInfo.serviceType = serviceInfoPayload.serviceType ?? null;
        serviceInfo.updatedBy = userId;
        await this.propertyServiceInfoRepo.save(serviceInfo);
      }

      // Handle Property Info
      if (listingPayload) {
        let propertyInfo = clientProperty.propertyInfo;
        if (!propertyInfo) {
          propertyInfo = this.propertyInfoRepo.create({ clientProperty, createdBy: userId });
        }

        // Map all listing fields to propertyInfo
        this.mapListingFieldsToPropertyInfo(propertyInfo, listingPayload);
        propertyInfo.updatedBy = userId;
        await this.propertyInfoRepo.save(propertyInfo);

        // Handle PropertyBedTypes
        if (listingPayload.propertyBedTypes && listingPayload.propertyBedTypes.length > 0) {
          await this.handlePropertyBedTypes(propertyInfo, listingPayload.propertyBedTypes);
        }

        // Handle PropertyUpsells
        if (listingPayload.propertyUpsells && listingPayload.propertyUpsells.length > 0) {
          await this.handlePropertyUpsells(propertyInfo, listingPayload.propertyUpsells);
        }

        // Handle Parking Info (array of parking rows)
        if (listingPayload.parking !== undefined) {
          await this.handlePropertyParkingInfo(propertyInfo, Array.isArray(listingPayload.parking) ? listingPayload.parking : []);
        }

        // Handle Bathroom Locations
        if (listingPayload.propertyBathroomLocation !== undefined) {
          await this.handlePropertyBathroomLocation(propertyInfo, listingPayload.propertyBathroomLocation ?? []);
        }

        // Handle Vendor Management
        if (listingPayload.vendorManagement) {
          await this.handleVendorManagementInfo(propertyInfo, listingPayload.vendorManagement);
        }
      }

      const refreshed = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["serviceInfo", "propertyInfo"] });
      updated.push({
        clientProperty: refreshed!,
        serviceInfo: refreshed!.serviceInfo ?? null,
        propertyInfo: refreshed!.propertyInfo ?? null
      });
    }

    return { message: "Client listing details updated", updated };
  }


  //publish listingIntake to hostaway
  async publishListingIntakeToHostaway(propertyId: string, userId: string) {
    const listingIntake = await this.propertyRepo.findOne({
      where: { id: propertyId },
      relations: ["onboarding", "serviceInfo", "propertyInfo", "propertyInfo.propertyBedTypes", "propertyInfo.propertyUpsells", "client"]
    });


    if (!listingIntake) {
      throw CustomErrorHandler.notFound(`Property with ID ${propertyId} not found.`);
    }

    // Here you would implement the logic to publish the property to Hostaway
    // This is a placeholder for the actual implementation
    logger.info("Publishing property to Hostaway:", listingIntake);

    // Simulate successful publishing
    let status = this.getListingIntakeStatus(listingIntake);
    if (status === "draft") {
      throw CustomErrorHandler.forbidden("Missing required fields. Cannot be published to Hostaway.");
    }
    if (status === "published") {
      throw CustomErrorHandler.forbidden("Property is already published to Hostaway.");
    }

    //prepare hostaway payload
    const hostawayPayload = {
      externalListingName: listingIntake.propertyInfo.externalListingName,
      // description: listingIntake.propertyInfo.description,
      personCapacity: listingIntake.propertyInfo.personCapacity,
      propertyTypeId: listingIntake.propertyInfo.propertyTypeId,
      roomType: listingIntake.propertyInfo.roomType,
      bedroomsNumber: listingIntake.propertyInfo.bedroomsNumber,
      // bedsNumber: listingIntake.propertyInfo.bedsNumber,
      bathroomsNumber: listingIntake.propertyInfo.bathroomsNumber,
      bathroomType: listingIntake.propertyInfo.bathroomType,
      guestBathroomsNumber: listingIntake.propertyInfo.guestBathroomsNumber,
      address: listingIntake.propertyInfo.address,
      // publicAddress: listingIntake.propertyInfo.publicAddress,
      // country: listingIntake.propertyInfo.country,
      // countryCode: listingIntake.propertyInfo.countryCode,
      // state: listingIntake.propertyInfo.state,
      // city: listingIntake.propertyInfo.city,
      // street: listingIntake.propertyInfo.street,
      // zipcode: listingIntake.propertyInfo.zipcode,
      timeZoneName: listingIntake.client.timezone,
      amenities: listingIntake.propertyInfo.amenities.map((amenity: any) => {
        return { amenityId: Number(amenity) };
      }),
      currencyCode: listingIntake.propertyInfo.currencyCode,
      price: listingIntake.propertyInfo.price,
      priceForExtraPerson: listingIntake.propertyInfo.priceForExtraPerson,
      guestsIncluded: listingIntake.propertyInfo.guestsIncluded,
      // cleaningFee: listingIntake.propertyInfo.cleaningFee,
      airbnbPetFeeAmount: listingIntake.propertyInfo.petFee,
      // houseRules: listingIntake.propertyInfo.houseRules,
      checkOutTime: listingIntake.propertyInfo.checkOutTime,
      checkInTimeStart: listingIntake.propertyInfo.checkInTimeStart,
      // checkInTimeEnd: listingIntake.propertyInfo.checkInTimeEnd,
      squareMeters: listingIntake.propertyInfo.squareMeters,
      // language: listingIntake.propertyInfo.language,
      // instantBookable: listingIntake.propertyInfo.instantBookable,
      wifiUsername: listingIntake.propertyInfo.wifiUsername,
      wifiPassword: listingIntake.propertyInfo.wifiPassword,
      // airBnbCancellationPolicyId: listingIntake.propertyInfo.airBnbCancellationPolicyId,
      // bookingCancellationPolicyId: listingIntake.propertyInfo.bookingCancellationPolicyId,
      // marriottBnbCancellationPolicyId: listingIntake.propertyInfo.marriottBnbCancellationPolicyId,
      // vrboCancellationPolicyId: listingIntake.propertyInfo.vrboCancellationPolicyId,
      // cancellationPolicyId: listingIntake.propertyInfo.cancellationPolicyId,
      // minNights: listingIntake.propertyInfo.minNights,
      // maxNights: listingIntake.propertyInfo.maxNights,
      // airbnbName: listingIntake.propertyInfo.airbnbName,
      // airbnbSummary: listingIntake.propertyInfo.airbnbSummary,
      // airbnbSpace: listingIntake.propertyInfo.airbnbSpace,
      // airbnbAccess: listingIntake.propertyInfo.airbnbAccess,
      // airbnbInteraction: listingIntake.propertyInfo.airbnbInteraction,
      // airbnbNeighborhoodOverview: listingIntake.propertyInfo.airbnbNeighborhoodOverview,
      // airbnbTransit: listingIntake.propertyInfo.airbnbTransit,
      // airbnbNotes: listingIntake.propertyInfo.airbnbNotes,
      // homeawayPropertyName: listingIntake.propertyInfo.homeawayPropertyName,
      // homeawayPropertyHeadline: listingIntake.propertyInfo.homeawayPropertyHeadline,
      // homeawayPropertyDescription: listingIntake.propertyInfo.homeawayPropertyDescription,
      // bookingcomPropertyName: listingIntake.propertyInfo.bookingcomPropertyName,
      // bookingcomPropertyDescription: listingIntake.propertyInfo.bookingcomPropertyDescription,
      // marriottListingName: listingIntake.propertyInfo.marriottListingName,
      // contactName: listingIntake.propertyInfo.contactName,
      // contactPhone1: listingIntake.propertyInfo.contactPhone1,
      // contactLanguage: listingIntake.propertyInfo.contactLanguage,

      listingBedTypes: listingIntake.propertyInfo.propertyBedTypes.map(bedType => ({
        bedTypeId: bedType.bedTypeId,
        quantity: bedType.quantity,
        bedroomNumber: bedType.bedroomNumber,
      })),

      // propertyLicenseNumber: listingIntake.propertyInfo.propertyLicenseNumber,
      // propertyLicenseType: listingIntake.propertyInfo.propertyLicenseType,
      // propertyLicenseIssueDate: listingIntake.propertyInfo.propertyLicenseIssueDate,
      // propertyLicenseExpirationDate: listingIntake.propertyInfo.propertyLicenseExpirationDate,
    };

    logger.info("Hostaway payload:", JSON.stringify(hostawayPayload));

    //simulate taking time of 10s
    // await new Promise(resolve => setTimeout(resolve, 10000));

    const response = await this.hostawayClient.createListing(hostawayPayload);
    if (!response) {
      throw new CustomErrorHandler(500, "Failed to publish listing intake to Hostaway");
    }
    // Update the listingIntake status to published
    listingIntake.status = "published";
    listingIntake.listingId = response.id; // Assuming response contains the Hostaway listing ID
    listingIntake.updatedBy = userId;
    await this.propertyRepo.save(listingIntake);

    return { message: "Property published to Hostaway successfully", listingIntake };
  }

  private getListingIntakeStatus(listingIntake: any) {
    const requiredFields = [
      "externalListingName",
      "address",
      "price",
      "guestsIncluded",
      "priceForExtraPerson",
      "currencyCode"
    ];

    const hasMissingValue = requiredFields.some(field => {
      const value = (listingIntake as any)[field];
      return value == null || value === "";
    });

    return hasMissingValue ? "draft" : "ready";
  }

  async updateFinancialsInternalForm(body: any, userId: string) {
    const { clientId, clientProperties } = body as PropertyOnboardingRequest & { clientProperties: Array<Property & { id: string; }>; };

    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const updated: Array<{ clientProperty: ClientPropertyEntity; propertyInfo: PropertyInfo | null; }> = [];

    for (const property of clientProperties) {
      const clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["propertyInfo", "client"] });
      if (!clientProperty) {
        throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
      }
      if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
        throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
      }

      if ((property as any).address !== undefined) {
        clientProperty.address = property.address;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      }

      const financials = (property as any)?.onboarding?.financials as Financials | undefined;
      if (financials) {
        let propertyInfo = clientProperty.propertyInfo;
        if (!propertyInfo) {
          propertyInfo = this.propertyInfoRepo.create({ clientProperty, createdBy: userId });
        }

        if (financials.minPrice !== undefined) propertyInfo.minPrice = financials.minPrice ?? null;
        if (financials.minNights !== undefined) propertyInfo.minNights = financials.minNights ?? null;
        if (financials.maxNights !== undefined) propertyInfo.maxNights = financials.maxNights ?? null;
        if (financials.propertyLicenseNumber !== undefined) propertyInfo.propertyLicenseNumber = financials.propertyLicenseNumber ?? null;
        if (financials.tax !== undefined) propertyInfo.tax = financials.tax ?? null;
        if (financials.financialNotes !== undefined) propertyInfo.financialNotes = financials.financialNotes ?? null;

        propertyInfo.updatedBy = userId;
        await this.propertyInfoRepo.save(propertyInfo);
      }

      const refreshed = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["propertyInfo"] });
      updated.push({ clientProperty: refreshed!, propertyInfo: refreshed!.propertyInfo ?? null });
    }

    return { message: "Internal financials updated", updated };
  }

  async updateManagementInternalForm(body: any, userId: string) {
    const { clientId, clientProperties } = body as PropertyOnboardingRequest & { clientProperties: Array<Property & { id: string; }>; };

    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const updated: Array<{ clientProperty: ClientPropertyEntity; propertyInfo: PropertyInfo | null; }> = [];

    for (const property of clientProperties) {
      const clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["propertyInfo", "client"] });
      if (!clientProperty) {
        throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
      }
      if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
        throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
      }

      if ((property as any).address !== undefined) {
        clientProperty.address = property.address;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      }

      const listingPayload = (property as any)?.onboarding?.listing;
      if (listingPayload) {
        let propertyInfo = clientProperty.propertyInfo;
        if (!propertyInfo) {
          propertyInfo = this.propertyInfoRepo.create({ clientProperty, createdBy: userId });
        }

        // Calendar Management
        if (listingPayload.canAnyoneBookAnytime !== undefined) propertyInfo.canAnyoneBookAnytime = listingPayload.canAnyoneBookAnytime ?? null;
        if (listingPayload.bookingAcceptanceNoticeNotes !== undefined) propertyInfo.bookingAcceptanceNoticeNotes = listingPayload.bookingAcceptanceNoticeNotes ?? null;
        if (listingPayload.leadTimeDays !== undefined) propertyInfo.leadTimeDays = listingPayload.leadTimeDays ?? null;
        if (listingPayload.calendarManagementNotes !== undefined) propertyInfo.calendarManagementNotes = listingPayload.calendarManagementNotes ?? null;

        // Reservation Management
        if (listingPayload.checkInTimeStart !== undefined) propertyInfo.checkInTimeStart = listingPayload.checkInTimeStart ?? null;
        if (listingPayload.checkInTimeEnd !== undefined) propertyInfo.checkInTimeEnd = listingPayload.checkInTimeEnd ?? null;
        if (listingPayload.checkOutTime !== undefined) propertyInfo.checkOutTime = listingPayload.checkOutTime ?? null;

        // Parking
        if (listingPayload.parking !== undefined) {
          await this.handlePropertyParkingInfo(propertyInfo, Array.isArray(listingPayload.parking) ? listingPayload.parking : []);
        }
        if (listingPayload.parkingInstructions !== undefined) propertyInfo.parkingInstructions = listingPayload.parkingInstructions ?? null;

        // Property Access
        if (listingPayload.checkInProcess !== undefined) propertyInfo.checkInProcess = listingPayload.checkInProcess ?? null;
        if (listingPayload.doorLockType !== undefined) propertyInfo.doorLockType = listingPayload.doorLockType ?? null;
        if (listingPayload.doorLockCodeType !== undefined) propertyInfo.doorLockCodeType = listingPayload.doorLockCodeType ?? null;
        if (listingPayload.codeResponsibleParty !== undefined) propertyInfo.codeResponsibleParty = listingPayload.codeResponsibleParty ?? null;
        if (listingPayload.doorLockAppName !== undefined) propertyInfo.doorLockAppName = listingPayload.doorLockAppName ?? null;
        if (listingPayload.doorLockAppUsername !== undefined) propertyInfo.doorLockAppUsername = listingPayload.doorLockAppUsername ?? null;
        if (listingPayload.doorLockAppPassword !== undefined) propertyInfo.doorLockAppPassword = listingPayload.doorLockAppPassword ?? null;
        if (listingPayload.lockboxLocation !== undefined) propertyInfo.lockboxLocation = listingPayload.lockboxLocation ?? null;
        if (listingPayload.lockboxCode !== undefined) propertyInfo.lockboxCode = listingPayload.lockboxCode ?? null;
        if (listingPayload.doorLockInstructions !== undefined) propertyInfo.doorLockInstructions = listingPayload.doorLockInstructions ?? null;

        // Waste Management
        if (listingPayload.wasteCollectionDays !== undefined) propertyInfo.wasteCollectionDays = listingPayload.wasteCollectionDays ?? null;
        if (listingPayload.wasteBinLocation !== undefined) propertyInfo.wasteBinLocation = listingPayload.wasteBinLocation ?? null;
        if (listingPayload.wasteManagementInstructions !== undefined) propertyInfo.wasteManagementInstructions = listingPayload.wasteManagementInstructions ?? null;

        // Property Upsells
        if (listingPayload.propertyUpsells && listingPayload.propertyUpsells.length > 0) {
          await this.handlePropertyUpsells(propertyInfo, listingPayload.propertyUpsells);
        }
        if (listingPayload.additionalServiceNotes !== undefined) propertyInfo.additionalServiceNotes = listingPayload.additionalServiceNotes ?? null;

        // Special Instructions for Guests
        if (listingPayload.checkInInstructions !== undefined) propertyInfo.checkInInstructions = listingPayload.checkInInstructions ?? null;
        if (listingPayload.checkOutInstructions !== undefined) propertyInfo.checkOutInstructions = listingPayload.checkOutInstructions ?? null;

        // House Rules
        if (listingPayload.allowPartiesAndEvents !== undefined) propertyInfo.allowPartiesAndEvents = listingPayload.allowPartiesAndEvents ?? null;
        if (listingPayload.allowSmoking !== undefined) propertyInfo.allowSmoking = listingPayload.allowSmoking ?? null;
        if (listingPayload.allowPets !== undefined) propertyInfo.allowPets = listingPayload.allowPets ?? null;
        if (listingPayload.petFee !== undefined) propertyInfo.petFee = listingPayload.petFee ?? null;
        if (listingPayload.numberOfPetsAllowed !== undefined) propertyInfo.numberOfPetsAllowed = listingPayload.numberOfPetsAllowed ?? null;
        if (listingPayload.petRestrictionsNotes !== undefined) propertyInfo.petRestrictionsNotes = listingPayload.petRestrictionsNotes ?? null;
        if (listingPayload.allowChildreAndInfants !== undefined) propertyInfo.allowChildreAndInfants = listingPayload.allowChildreAndInfants ?? null;
        if (listingPayload.childrenInfantsRestrictionReason !== undefined) propertyInfo.childrenInfantsRestrictionReason = listingPayload.childrenInfantsRestrictionReason ?? null;
        if (listingPayload.allowLuggageDropoffBeforeCheckIn !== undefined) propertyInfo.allowLuggageDropoffBeforeCheckIn = listingPayload.allowLuggageDropoffBeforeCheckIn ?? null;
        if (listingPayload.otherHouseRules !== undefined) propertyInfo.otherHouseRules = listingPayload.otherHouseRules ?? null;

        // Vendor Management
        if (listingPayload.vendorManagement) {
          await this.handleVendorManagementInfo(propertyInfo, listingPayload.vendorManagement);
        }

        // Management Notes
        if (listingPayload.managementNotes !== undefined) propertyInfo.managementNotes = listingPayload.managementNotes ?? null;

        propertyInfo.updatedBy = userId;
        await this.propertyInfoRepo.save(propertyInfo);
      }

      const refreshed = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["propertyInfo"] });
      updated.push({ clientProperty: refreshed!, propertyInfo: refreshed!.propertyInfo ?? null });
    }

    return { message: "Internal management updated", updated };
  }


}
