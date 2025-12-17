import { appDatabase } from "../utils/database.util";
import { ClientEntity } from "../entity/Client";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { ClientSecondaryContact } from "../entity/ClientSecondaryContact";
import CustomErrorHandler from "../middleware/customError.middleware";
import { In, IsNull, Not, Or } from "typeorm";
import { ListingService } from "./ListingService";
import { ClientTicket } from "../entity/ClientTicket";
import { PropertyOnboarding } from "../entity/PropertyOnboarding";
import { PropertyServiceInfo } from "../entity/PropertyServiceInfo";
import { PropertyInfo } from "../entity/PropertyInfo";
import { PropertyBedTypes } from "../entity/PropertyBedTypes";
import logger from "../utils/logger.utils";
import { PropertyUpsells } from "../entity/PropertyUpsells";
import { PropertyParkingInfo } from "../entity/PropertyParkingInfo";
import { PropertyBathroomLocation } from "../entity/PropertyBathroomLocation";
import { PropertyVendorManagement } from "../entity/PropertyVendorManagement";
import { SuppliesToRestock } from "../entity/SuppliesToRestock";
import { VendorInfo } from "../entity/VendorInfo";
import { HostAwayClient } from "../client/HostAwayClient";
import fs from "fs";
import csv from "csv-parser";
import { timezoneAmerica } from "../constant";
import { isEmail } from "../helpers/helpers";
import { OpenPhoneService } from "./OpenPhoneService";
import { UsersService } from "./UsersService";

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
  streetAddress?: string | null;
  unitNumber?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zipCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  onboarding: Onboarding;
}

interface Onboarding {
  serviceInfo: ServiceInfo;
  sales: Sales;
  listing: Listing;
  photography: Photography;
  contractorsVendor?: ContractorsVendor;
  financial?: Financial;
  financials?: Financials;
  clientAcknowledgement?: {
    acknowledgePropertyReadyByStartDate?: boolean | null;
    agreesUnpublishExternalListings?: boolean | null;
    acknowledgesResponsibilityToInform?: boolean | null;
  };
}

interface ContractorsVendor {
  cleaning: string | null;
  maintenance: string | null;
  biWeeklyInspection: string | null;
}

interface Financial {
  claimsFee: string | null;
  onboardingFee: string | null;
  onboardingFeeDetails: string | null;
  offboardingFee: string | null;
  offboardingFeeDetails: string | null;
  techFee: string | null;
  techFeeDetails: string | null;
  payoutSchedule: string | null;
  taxesAddendum: string | null;
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
  minPrice: number | null;
}

interface Listing {
  clientCurrentListingLink: string[] | null;
  listingOwner: "Luxury Lodging" | "Client" | null;
  clientListingStatus: "Closed" | "Open - Will Close" | "Open - Keeping" | null;
  targetLiveDate: string | null;  // yyyy-mm-dd
  targetStartDate: string | null; // yyyy-mm-dd
  targetDateNotes: string | null;
  upcomingReservations: string | null;
  onboardingCallSchedule?: string | null;  // yyyy-mm-dd
  actualLiveDate?: string | null;  // yyyy-mm-dd
  actualStartDate?: string | null; // yyyy-mm-dd

  // Client-facing onboarding specific fields
  acknowledgePropertyReadyByStartDate?: boolean | null;
  agreesUnpublishExternalListings?: boolean | null;
  externalListingNotes?: string | null;
  acknowledgesResponsibilityToInform?: boolean | null;

  // Property listing info fields
  propertyTypeId?: string | null;
  noOfFloors?: number | null;
  squareMeters?: number | null;
  squareFeet?: number | null;
  personCapacity?: number | null;
  roomType?: string | null;
  bedroomsNumber?: number | null;
  bedroomNotes?: string | null;
  propertyBedTypes?: Array<{
    floorLevel: number;
    bedroomNumber: number;
    bedTypeId: string;
    quantity: number;
  }> | null;
  bathroomType?: string | null;
  bathroomsNumber?: number | null;
  guestBathroomsNumber?: number | null;
  bathroomNotes?: string | null;
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
  emergencyBackUpCode?: string | null;
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
    acknowledgeMaintenanceResponsibility?: boolean | null;
    authorizeLuxuryLodgingAction?: boolean | null;
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
  minPriceWeekday?: number | null;
  minPriceWeekend?: number | null;
  minNights?: number | null;
  minNightsWeekday?: number | null;
  minNightsWeekend?: number | null;
  maxNights?: number | null;
  propertyLicenseNumber?: string | null;
  tax?: string | null;
  financialNotes?: string | null;

  statementSchedule?: string | null;
  statementType?: string | null;
  payoutMethod?: string | null;
  claimFee?: string | null;
  claimFeeNotes?: string | null;
  techFee?: string | null;
  techFeeNotes?: string | null;
  minimumStay?: boolean | null;
  maximumStay?: boolean | null;
  pricingStrategyPreference?: string | null;
  minimumNightsRequiredByLaw?: string | null;
  onboardingFee?: string | null;
  onboardingFeeAmountAndConditions?: string | null;
  offboardingFee?: string | null;
  offboardingFeeAmountAndConditions?: string | null;
  payoutSchdule?: string | null;
  taxesAddedum?: string | null;
}

interface CsvRow {
  "PC_First_Name": string;
  "PC_Last_Name": string;
  "PC_Preferred_Name": string;
  "PC_Email": string;
  "PC_Phone": string;
  "PC_Timezone": string;
  "PC_Company": string;
  "Client_Folder": string;

  "SC_First_Name": string;
  "SC_Last_Name": string;
  "SC_Preferred_Name": string;
  "SC_Email": string;
  "SC_Phone": string;
  "SC_Timezone": string;
  "SC_Company": string;

  "POC_First_Name": string;
  "POC_Last_Name": string;
  "POC_Preferred_Name": string;
  "POC_Email": string;
  "POC_Phone": string;
  "POC_Timezone": string;
  "POC_Company": string;

  "Property_Id": string;
  "Service_Type": string;
  "PM_Fee": string;
}

enum PropertyStatus {
  ACTIVE = "active",
  ONBOARDING = "onboarding",
  ON_HOLD = "on-hold",
  POTENTIAL_OFFBOARDING = "potential-offboarding",
  OFFBOARDING = "offboarding",
  INACTIVE = "inactive",
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

  async checkEmailExists(email: string) {
    const existingClient = await this.clientRepo.findOne({
      where: { email, deletedAt: IsNull() },
      relations: ["secondaryContacts", "properties"],
    });
    return existingClient;
  }

  async checkExistingClient(firstName?: string, lastName?: string, email?: string, phone?: string) {
    const qb = this.clientRepo.createQueryBuilder("client")
      .leftJoinAndSelect("client.secondaryContacts", "secondaryContacts")
      .leftJoinAndSelect("client.properties", "properties")
      .where("client.deletedAt IS NULL");

    const orConditions: string[] = [];
    const params: any = {};

    if (firstName && lastName) {
      orConditions.push("(client.firstName = :firstName AND client.lastName = :lastName)");
      params.firstName = firstName;
      params.lastName = lastName;
    }

    if (email) {
      orConditions.push("client.email = :email");
      params.email = email;
    }

    if (phone) {
      orConditions.push("client.phone = :phone");
      params.phone = phone;
    }

    if (orConditions.length === 0) {
      return null;
    }

    qb.andWhere(`(${orConditions.join(" OR ")})`);
    qb.setParameters(params);

    const existingClient = await qb.getOne();

    return existingClient;
  }

  async saveClient(
    clientData: Partial<ClientEntity>,
    userId: string,
    source: string,
    secondaryContacts?: Partial<ClientSecondaryContact>[],
    clientProperties?: string[],
  ) {
    const listingService = new ListingService();

    // Check if email already exists
    if (clientData.email) {
      const existingClient = await this.checkEmailExists(clientData.email);
      if (existingClient) {
        throw CustomErrorHandler.alreadyExists("A client with this email already exists", {
          existingClient: {
            id: existingClient.id,
            firstName: existingClient.firstName,
            lastName: existingClient.lastName,
            email: existingClient.email,
            phone: existingClient.phone,
            companyName: existingClient.companyName,
            status: existingClient.status,
            serviceType: existingClient.serviceType,
            propertiesCount: existingClient.properties?.length || 0,
            secondaryContactsCount: existingClient.secondaryContacts?.length || 0,
          }
        });
      }
    }

    // 1️⃣ Determine status based on properties
    if (clientProperties && clientProperties.length > 0) {
      clientData.status = "active";
    } else {
      clientData.status = "onboarding";
    }

    // 2️⃣ Create and save client first
    const client = this.clientRepo.create({ ...clientData, createdBy: userId, source });
    const savedClient = await this.clientRepo.save(client);

    // 3️⃣ Save secondary contacts (if any)
    if (secondaryContacts && secondaryContacts.length > 0) {
      const createdContacts = secondaryContacts.map((contact) =>
        this.contactRepo.create({
          ...contact,
          createdBy: userId,
          client: savedClient, // set relation manually
        })
      );
      await this.contactRepo.save(createdContacts);
    }

    // 4️⃣ Save properties (if any)
    if (clientProperties && clientProperties.length > 0) {
      for (const listingId of clientProperties) {
        // Use database transaction for each property to ensure data consistency
        await appDatabase.transaction(async (transactionalEntityManager) => {
          try {
            const listingInfo = await listingService.getListingInfo(Number(listingId), userId);

            if (!listingInfo) {
              logger.error(`❌ Listing not found for listingId: ${listingId}`);
              return; // Skip this listingId
            }

            logger.info(`🔄 Processing listingId: ${listingId} for client: ${savedClient.id}`);

            // --- Create property first ---
            const property = transactionalEntityManager.create(ClientPropertyEntity, {
              listingId,
              address: listingInfo.address,
              status: PropertyStatus.ACTIVE,
              createdBy: userId,
              client: savedClient, // 👈 link to client
            });

            // --- Save property first to get the ID ---
            const savedProperty = await transactionalEntityManager.save(property);

            // --- Create propertyInfo ---
            const propertyInfo = transactionalEntityManager.create(PropertyInfo, {
              externalListingName: listingInfo.externalListingName,
              internalListingName: listingInfo.internalListingName,
              price: listingInfo.price,
              priceForExtraPerson: listingInfo.priceForExtraPerson,
              propertyTypeId: listingInfo.propertyTypeId != null ? String(listingInfo.propertyTypeId) : null,
              roomType: listingInfo.roomType,
              bedroomsNumber: listingInfo.bedroomsNumber,
              bathroomsNumber: listingInfo.bathroomsNumber,
              bathroomType: listingInfo.bathroomType,
              guestBathroomsNumber: listingInfo.guestBathroomsNumber,
              address: listingInfo.address,
              currencyCode: listingInfo.currencyCode,
              personCapacity: listingInfo.personCapacity,
              petFee: listingInfo.airbnbPetFeeAmount,
              checkOutTime: listingInfo.checkOutTime,
              checkInTimeStart: listingInfo.checkInTimeStart,
              checkInTimeEnd: listingInfo.checkInTimeEnd,
              squareMeters: listingInfo.squareMeters,
              wifiUsername: listingInfo.wifiUsername,
              wifiPassword: listingInfo.wifiPassword,
              minNights: listingInfo.minNights,
              maxNights: listingInfo.maxNights,
              propertyLicenseNumber: listingInfo.propertyLicenseNumber,
              createdBy: userId,
              clientProperty: savedProperty, // 👈 link to saved property
            });

            // --- Create and save vendorManagementInfo ---
            const vendorManagementInfo = transactionalEntityManager.create(PropertyVendorManagement, {
              cleaningFee: listingInfo.cleaningFee,
            });
            const savedVendorManagementInfo = await transactionalEntityManager.save(vendorManagementInfo);
            propertyInfo.vendorManagementInfo = savedVendorManagementInfo;

            // --- Save propertyInfo ---
            const savedPropertyInfo = await transactionalEntityManager.save(propertyInfo);

            // --- Set amenities as simple array ---
            // if (listingInfo.listingAmenities && listingInfo.listingAmenities.length > 0) {
            //   savedPropertyInfo.amenities = listingInfo.listingAmenities.map((amenity) => String(amenity.amenityId));
            //   await transactionalEntityManager.save(savedPropertyInfo);
            // }

            // --- Save property bed types ---
            // if (listingInfo.listingBedTypes && listingInfo.listingBedTypes.length > 0) {
            //   const bedTypes = listingInfo.listingBedTypes.map((bedType) =>
            //     transactionalEntityManager.create(PropertyBedTypes, {
            //       haId: bedType.id,
            //       bedroomNumber: bedType.bedroomNumber,
            //       bedTypeId: bedType.bedTypeId,
            //       quantity: bedType.quantity,
            //       propertyId: savedPropertyInfo, // 👈 link to propertyInfo entity
            //     })
            //   );
            //   await transactionalEntityManager.save(bedTypes);
            // }

            // --- Update property with propertyInfo relation ---
            savedProperty.propertyInfo = savedPropertyInfo;
            await transactionalEntityManager.save(savedProperty);

            logger.info(`✅ Successfully saved property for listingId: ${listingId}`);

          } catch (err) {
            logger.error(`❌ Error while saving property for listingId: ${listingId}`, err);
            throw err; // Re-throw to trigger transaction rollback
          }
        }).catch((err) => {
          logger.error(`❌ Transaction failed for listingId: ${listingId}`, err);
          // Continue with next listingId instead of breaking the entire process
        });
      }
    }

    // 5️⃣ Return full client with relations (optional)
    return await this.clientRepo.findOne({
      where: { id: savedClient.id },
      relations: ["secondaryContacts", "properties", "properties.propertyInfo"],
    });
  }


  async updateClient(
    clientData: Partial<ClientEntity>,
    userId: string,
    secondaryContacts?: Partial<ClientSecondaryContact>[],
    clientProperties?: string[],
  ) {
    const listingService = new ListingService();

    if (clientProperties && clientProperties.length > 0) {
      clientData.status = "active";
    } else {
      clientData.status = "onboarding"; // if no properties are associated, set status to Onboarding
    }

    const client = await this.clientRepo.findOne({ where: { id: clientData.id } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    // Check if email is being changed and if the new email already exists for another client
    if (clientData.email && clientData.email !== client.email) {
      const existingClient = await this.clientRepo.findOne({
        where: { email: clientData.email },
        relations: ["secondaryContacts", "properties"],
      });
      if (existingClient && existingClient.id !== client.id) {
        throw CustomErrorHandler.alreadyExists("A client with this email already exists", {
          existingClient: {
            id: existingClient.id,
            firstName: existingClient.firstName,
            lastName: existingClient.lastName,
            email: existingClient.email,
            phone: existingClient.phone,
            companyName: existingClient.companyName,
            status: existingClient.status,
            serviceType: existingClient.serviceType,
            propertiesCount: existingClient.properties?.length || 0,
            secondaryContactsCount: existingClient.secondaryContacts?.length || 0,
          }
        });
      }
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
      const listingService = new ListingService();
      const existingProperties = await this.propertyRepo.find({
        where: { client: { id: client.id } },
        relations: ["propertyInfo", "propertyInfo.vendorManagementInfo", "propertyInfo.propertyBedTypes"]
      });
      const existingListingIds = existingProperties.map((p) => p.listingId);

      // Delete properties that are not in the incoming list
      const propertiesToDelete = existingProperties.filter(
        (p) => !clientProperties.map(String).includes(p.listingId)
      );
      
      if (propertiesToDelete.length > 0) {
        //updated deletedBy and deletedAt instead of hard delete
        propertiesToDelete.forEach(property => {
          property.deletedAt = new Date();
          property.deletedBy = userId;
        });
        await this.propertyRepo.save(propertiesToDelete);
      }

      // Process all properties (both existing and new) to sync with latest listing data
      const updatedProperties = [];

      for (const listingId of clientProperties) {
        // Use database transaction for each property to ensure data consistency
        await appDatabase.transaction(async (transactionalEntityManager) => {
          try {
            const listingInfo = await listingService.getListingInfo(Number(listingId), userId);

            if (!listingInfo) {
              logger.error(`❌ Listing not found for listingId: ${listingId}`);
              return; // Skip this listingId
            }

            const isExistingProperty = existingListingIds.includes(String(listingId));
            const existingProperty = existingProperties.find(p => p.listingId == listingId);

            if (isExistingProperty && existingProperty) {
              // Update existing property and its related data
              logger.info(`🔄 Updating existing property for listingId: ${listingId} for client: ${client.id}`);

              // Update property basic info
              existingProperty.address = listingInfo.address;
              existingProperty.updatedAt = new Date();
              existingProperty.updatedBy = userId;
              const savedProperty = await transactionalEntityManager.save(existingProperty);

              // Update propertyInfo if it exists
              if (existingProperty.propertyInfo) {
                const propertyInfo = existingProperty.propertyInfo;

                // Update all propertyInfo fields with fresh listing data
                propertyInfo.externalListingName = listingInfo.externalListingName;
                propertyInfo.internalListingName = listingInfo.internalListingName;
                propertyInfo.price = listingInfo.price;
                propertyInfo.priceForExtraPerson = listingInfo.priceForExtraPerson;
                propertyInfo.propertyTypeId = listingInfo.propertyTypeId != null ? String(listingInfo.propertyTypeId) : null;
                propertyInfo.roomType = listingInfo.roomType;
                propertyInfo.bedroomsNumber = listingInfo.bedroomsNumber;
                propertyInfo.bathroomsNumber = listingInfo.bathroomsNumber;
                propertyInfo.bathroomType = listingInfo.bathroomType;
                propertyInfo.guestBathroomsNumber = listingInfo.guestBathroomsNumber;
                propertyInfo.address = listingInfo.address;
                propertyInfo.currencyCode = listingInfo.currencyCode;
                propertyInfo.personCapacity = listingInfo.personCapacity;
                propertyInfo.petFee = listingInfo.airbnbPetFeeAmount;
                propertyInfo.checkOutTime = listingInfo.checkOutTime;
                propertyInfo.checkInTimeStart = listingInfo.checkInTimeStart;
                propertyInfo.checkInTimeEnd = listingInfo.checkInTimeEnd;
                propertyInfo.squareMeters = listingInfo.squareMeters;
                propertyInfo.wifiUsername = listingInfo.wifiUsername;
                propertyInfo.wifiPassword = listingInfo.wifiPassword;
                propertyInfo.minNights = listingInfo.minNights;
                propertyInfo.maxNights = listingInfo.maxNights;
                propertyInfo.propertyLicenseNumber = listingInfo.propertyLicenseNumber;
                propertyInfo.updatedAt = new Date();
                propertyInfo.updatedBy = userId;

                // Update vendorManagementInfo
                if (propertyInfo.vendorManagementInfo) {
                  propertyInfo.vendorManagementInfo.cleaningFee = listingInfo.cleaningFee;
                  await transactionalEntityManager.save(propertyInfo.vendorManagementInfo);
                } else {
                  // Create vendorManagementInfo if it doesn't exist
                  const vendorManagementInfo = transactionalEntityManager.create(PropertyVendorManagement, {
                    cleaningFee: listingInfo.cleaningFee,
                  });
                  propertyInfo.vendorManagementInfo = await transactionalEntityManager.save(vendorManagementInfo);
                }

                // Update amenities
                if (listingInfo.listingAmenities && listingInfo.listingAmenities.length > 0) {
                  propertyInfo.amenities = listingInfo.listingAmenities.map((amenity) => String(amenity.amenityId));
                }

                const savedPropertyInfo = await transactionalEntityManager.save(propertyInfo);

                // Update bed types - remove existing and create new ones
                if (propertyInfo.propertyBedTypes && propertyInfo.propertyBedTypes.length > 0) {
                  await transactionalEntityManager.remove(propertyInfo.propertyBedTypes);
                }

                // if (listingInfo.listingBedTypes && listingInfo.listingBedTypes.length > 0) {
                //   const bedTypes = listingInfo.listingBedTypes.map((bedType) =>
                //     transactionalEntityManager.create(PropertyBedTypes, {
                //       haId: bedType.id,
                //       bedroomNumber: bedType.bedroomNumber,
                //       bedTypeId: bedType.bedTypeId,
                //       quantity: bedType.quantity,
                //       propertyId: savedPropertyInfo, // 👈 link to propertyInfo entity
                //     })
                //   );
                //   await transactionalEntityManager.save(bedTypes);
                // }

                savedProperty.propertyInfo = savedPropertyInfo;
                await transactionalEntityManager.save(savedProperty);
              } else {
                // Create propertyInfo if it doesn't exist for existing property
                const propertyInfo = transactionalEntityManager.create(PropertyInfo, {
                  externalListingName: listingInfo.externalListingName,
                  internalListingName: listingInfo.internalListingName,
                  price: listingInfo.price,
                  priceForExtraPerson: listingInfo.priceForExtraPerson,
                  propertyTypeId: listingInfo.propertyTypeId != null ? String(listingInfo.propertyTypeId) : null,
                  roomType: listingInfo.roomType,
                  bedroomsNumber: listingInfo.bedroomsNumber,
                  bathroomsNumber: listingInfo.bathroomsNumber,
                  bathroomType: listingInfo.bathroomType,
                  guestBathroomsNumber: listingInfo.guestBathroomsNumber,
                  address: listingInfo.address,
                  currencyCode: listingInfo.currencyCode,
                  personCapacity: listingInfo.personCapacity,
                  petFee: listingInfo.airbnbPetFeeAmount,
                  checkOutTime: listingInfo.checkOutTime,
                  checkInTimeStart: listingInfo.checkInTimeStart,
                  checkInTimeEnd: listingInfo.checkInTimeEnd,
                  squareMeters: listingInfo.squareMeters,
                  wifiUsername: listingInfo.wifiUsername,
                  wifiPassword: listingInfo.wifiPassword,
                  minNights: listingInfo.minNights,
                  maxNights: listingInfo.maxNights,
                  propertyLicenseNumber: listingInfo.propertyLicenseNumber,
                  createdBy: userId,
                  clientProperty: savedProperty,
                });

                // Create vendorManagementInfo
                const vendorManagementInfo = transactionalEntityManager.create(PropertyVendorManagement, {
                  cleaningFee: listingInfo.cleaningFee,
                });
                const savedVendorManagementInfo = await transactionalEntityManager.save(vendorManagementInfo);
                propertyInfo.vendorManagementInfo = savedVendorManagementInfo;

                const savedPropertyInfo = await transactionalEntityManager.save(propertyInfo);

                // Set amenities
                if (listingInfo.listingAmenities && listingInfo.listingAmenities.length > 0) {
                  savedPropertyInfo.amenities = listingInfo.listingAmenities.map((amenity) => String(amenity.amenityId));
                  await transactionalEntityManager.save(savedPropertyInfo);
                }

                // Create bed types
                // if (listingInfo.listingBedTypes && listingInfo.listingBedTypes.length > 0) {
                //   const bedTypes = listingInfo.listingBedTypes.map((bedType) =>
                //     transactionalEntityManager.create(PropertyBedTypes, {
                //       haId: bedType.id,
                //       bedroomNumber: bedType.bedroomNumber,
                //       bedTypeId: bedType.bedTypeId,
                //       quantity: bedType.quantity,
                //       propertyId: savedPropertyInfo,
                //     })
                //   );
                //   await transactionalEntityManager.save(bedTypes);
                // }

                savedProperty.propertyInfo = savedPropertyInfo;
                await transactionalEntityManager.save(savedProperty);
              }

              updatedProperties.push(savedProperty);
              logger.info(`✅ Successfully updated existing property for listingId: ${listingId}`);

            } else {
              // Create new property with full propertyInfo and related data
              logger.info(`🔄 Creating new property for listingId: ${listingId} for client: ${client.id}`);

              // --- Create property first ---
              const property = transactionalEntityManager.create(ClientPropertyEntity, {
                listingId,
                address: listingInfo.address,
                status: PropertyStatus.ACTIVE,
                createdBy: userId,
                client: client, // 👈 link to client
              });

              // --- Save property first to get the ID ---
              const savedProperty = await transactionalEntityManager.save(property);

              // --- Create propertyInfo ---
              const propertyInfo = transactionalEntityManager.create(PropertyInfo, {
                externalListingName: listingInfo.externalListingName,
                internalListingName: listingInfo.internalListingName,
                price: listingInfo.price,
                priceForExtraPerson: listingInfo.priceForExtraPerson,
                propertyTypeId: listingInfo.propertyTypeId != null ? String(listingInfo.propertyTypeId) : null,
                roomType: listingInfo.roomType,
                bedroomsNumber: listingInfo.bedroomsNumber,
                bathroomsNumber: listingInfo.bathroomsNumber,
                bathroomType: listingInfo.bathroomType,
                guestBathroomsNumber: listingInfo.guestBathroomsNumber,
                address: listingInfo.address,
                currencyCode: listingInfo.currencyCode,
                personCapacity: listingInfo.personCapacity,
                petFee: listingInfo.airbnbPetFeeAmount,
                checkOutTime: listingInfo.checkOutTime,
                checkInTimeStart: listingInfo.checkInTimeStart,
                checkInTimeEnd: listingInfo.checkInTimeEnd,
                squareMeters: listingInfo.squareMeters,
                wifiUsername: listingInfo.wifiUsername,
                wifiPassword: listingInfo.wifiPassword,
                minNights: listingInfo.minNights,
                maxNights: listingInfo.maxNights,
                propertyLicenseNumber: listingInfo.propertyLicenseNumber,
                createdBy: userId,
                clientProperty: savedProperty, // 👈 link to saved property
              });

              // --- Create and save vendorManagementInfo ---
              const vendorManagementInfo = transactionalEntityManager.create(PropertyVendorManagement, {
                cleaningFee: listingInfo.cleaningFee,
              });
              const savedVendorManagementInfo = await transactionalEntityManager.save(vendorManagementInfo);
              propertyInfo.vendorManagementInfo = savedVendorManagementInfo;

              // --- Save propertyInfo ---
              const savedPropertyInfo = await transactionalEntityManager.save(propertyInfo);

              // --- Set amenities as simple array ---
              if (listingInfo.listingAmenities && listingInfo.listingAmenities.length > 0) {
                savedPropertyInfo.amenities = listingInfo.listingAmenities.map((amenity) => String(amenity.amenityId));
                await transactionalEntityManager.save(savedPropertyInfo);
              }

              // // --- Save property bed types ---
              // if (listingInfo.listingBedTypes && listingInfo.listingBedTypes.length > 0) {
              //   const bedTypes = listingInfo.listingBedTypes.map((bedType) =>
              //     transactionalEntityManager.create(PropertyBedTypes, {
              //       haId: bedType.id,
              //       bedroomNumber: bedType.bedroomNumber,
              //       bedTypeId: bedType.bedTypeId,
              //       quantity: bedType.quantity,
              //       propertyId: savedPropertyInfo, // 👈 link to propertyInfo entity
              //     })
              //   );
              //   await transactionalEntityManager.save(bedTypes);
              // }

              // --- Update property with propertyInfo relation ---
              savedProperty.propertyInfo = savedPropertyInfo;
              await transactionalEntityManager.save(savedProperty);

              updatedProperties.push(savedProperty);
              logger.info(`✅ Successfully created new property for listingId: ${listingId}`);
            }

          } catch (err) {
            logger.error(`❌ Error while processing property for listingId: ${listingId}`, err);
            throw err; // Re-throw to trigger transaction rollback
          }
        }).catch((err) => {
          logger.error(`❌ Transaction failed for listingId: ${listingId}`, err);
          // Continue with next listingId instead of breaking the entire process
        });
      }

      client.properties = updatedProperties;
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
      // ✅ NEW: fetch property-related entities for PDF generation
      .leftJoinAndSelect("propertyInfo.propertyBedTypes", "propertyBedTypes")
      .leftJoinAndSelect("propertyInfo.propertyBathroomLocation", "propertyBathroomLocation")
      .leftJoinAndSelect("propertyInfo.propertyParkingInfo", "propertyParkingInfo")
      .leftJoinAndSelect("propertyInfo.propertyUpsells", "propertyUpsells")
      .leftJoinAndSelect("propertyInfo.vendorManagementInfo", "vendorManagementInfo")
      .leftJoinAndSelect("vendorManagementInfo.vendorInfo", "vendorInfo")
      .leftJoinAndSelect("vendorManagementInfo.suppliesToRestock", "suppliesToRestock")
      .where("client.deletedAt IS NULL")
      .orderBy("client.createdAt", "DESC");
    //order by client.createdAt desc

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
      query.andWhere("serviceInfo.serviceType IN (:...serviceTypes)", { serviceTypes: filter.serviceType });
    }

    if (filter.status && filter.status.length > 0) {
      query.andWhere("property.status IN (:...statuses)", { statuses: filter.status });
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
      const ticketCount = await this.getClientTicketCount(listingIds);
      return { ...client, clientSatisfaction, ticketCount };
    }));

    const satisfactionCounts = transformedData.reduce(
      (acc, client) => {
        if (client.clientSatisfaction) {
          acc[client.clientSatisfaction] = (acc[client.clientSatisfaction] || 0) + 1;
        }
        return acc;
      },
      { "Very Satisfied": 0, "Satisfied": 0, "Neutral": 0, "Dissatisfied": 0, "Very Dissatisfied": 0 }
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

  async deleteProperty(propertyId: string, userId: string) {
    const property = await this.propertyRepo.findOne({ where: { id: propertyId } });
    if (!property) {
      throw CustomErrorHandler.notFound("Property not found");
    }

    // Soft delete by setting deletedAt and deletedBy
    property.deletedAt = new Date();
    property.deletedBy = userId;
    await this.propertyRepo.save(property);
  }

  async getClientMetadata() {
    // find the total no. of clients whose status is other than offboarded
    const totalActiveClients = await this.clientRepo.count({ where: { status: Not(PropertyStatus.INACTIVE), deletedAt: IsNull() } });

    // total no. of each serviceType from client properties' serviceInfo
    const serviceTypeCounts = await this.clientRepo.createQueryBuilder("client")
      .leftJoin("client.properties", "property", "property.deletedAt IS NULL")
      .leftJoin("property.serviceInfo", "serviceInfo", "serviceInfo.deletedAt IS NULL")
      .select("serviceInfo.serviceType", "serviceType")
      .addSelect("COUNT(*)", "count")
      .where("client.status != :status AND client.deletedAt IS NULL", { status: PropertyStatus.INACTIVE })
      .andWhere("serviceInfo.serviceType IS NOT NULL")
      .groupBy("serviceInfo.serviceType")
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

  async getClientTicketCount(listingIds: string[]) {
    const ticketCount = await this.clientTicketRepo.count({
      where: {
        listingId: In(listingIds),
        deletedAt: IsNull(),
      },
    });

    return ticketCount;
  }

  async saveClientWithPreOnboarding(
    primaryContact: Partial<ClientEntity>,
    userId: string,
    source: string,
    secondaryContacts: Partial<ClientSecondaryContact>[] | undefined,
    clientProperties: any[],
    existingClientId?: string,
  ) {
    // Use transaction to ensure atomicity
    return await appDatabase.transaction(async (transactionalEntityManager) => {
      const clientRepo = transactionalEntityManager.getRepository(ClientEntity);
      const contactRepo = transactionalEntityManager.getRepository(ClientSecondaryContact);
      const propertyRepo = transactionalEntityManager.getRepository(ClientPropertyEntity);
      const serviceInfoRepo = transactionalEntityManager.getRepository(PropertyServiceInfo);
      const onboardingRepo = transactionalEntityManager.getRepository(PropertyOnboarding);
      const propertyInfoRepo = transactionalEntityManager.getRepository(PropertyInfo);
      const vendorManagementRepo = transactionalEntityManager.getRepository(PropertyVendorManagement);

      let savedClient: ClientEntity;

      // If existingClientId is provided, update existing client
      if (existingClientId) {
        savedClient = await clientRepo.findOne({
          where: { id: existingClientId, deletedAt: IsNull() },
        });

        if (!savedClient) {
          throw CustomErrorHandler.notFound("Client not found");
        }

        // Update client information
        Object.assign(savedClient, {
          ...primaryContact,
          updatedAt: new Date(),
          updatedBy: userId,
        });

        // Update status based on properties
        savedClient.status = clientProperties && clientProperties.length > 0 ? "active" : "onboarding";

        savedClient = await clientRepo.save(savedClient);
      } else {
        // 1. Check if email already exists (only for new clients)
        if (primaryContact.email) {
          const existingClient = await clientRepo.findOne({
            where: { email: primaryContact.email, deletedAt: IsNull() },
          });
          if (existingClient) {
            throw CustomErrorHandler.alreadyExists("A client with this email already exists", {
              existingClient: {
                id: existingClient.id,
                firstName: existingClient.firstName,
                lastName: existingClient.lastName,
                email: existingClient.email,
                phone: existingClient.phone,
                companyName: existingClient.companyName,
                status: existingClient.status,
                serviceType: existingClient.serviceType,
                propertiesCount: 0,
                secondaryContactsCount: 0,
              }
            });
          }
        }

        // 2. Create and save client
        const client = clientRepo.create({
          ...primaryContact,
          createdBy: userId,
          source,
          status: "onboarding", // Will be updated after properties are saved
        });
        savedClient = await clientRepo.save(client);
      }

      // 3. Save secondary contacts (if any)
      if (secondaryContacts && secondaryContacts.length > 0) {
        if (existingClientId) {
          // For existing client, handle update/create/delete of secondary contacts
          const existingContacts = await contactRepo.find({
            where: { client: { id: existingClientId }, deletedAt: IsNull() },
          });
          const existingContactIds = existingContacts.map((c) => c.id);
          const incomingContactIds = secondaryContacts.map((c) => c.id).filter((id): id is string => !!id);

          // Soft delete contacts that are not in the incoming list
          const contactsToDelete = existingContacts.filter((c) => !incomingContactIds.includes(c.id));
          if (contactsToDelete.length > 0) {
            contactsToDelete.forEach(contact => {
              contact.deletedAt = new Date();
              contact.deletedBy = userId;
            });
            await contactRepo.save(contactsToDelete);
          }

          // Update or create contacts
          const contactsToSave = secondaryContacts.map((contact) => {
            if (contact.id && existingContactIds.includes(contact.id)) {
              const existingContact = existingContacts.find((c) => c.id === contact.id)!;
              Object.assign(existingContact, contact);
              existingContact.updatedAt = new Date();
              existingContact.updatedBy = userId;
              return existingContact;
            } else {
              return contactRepo.create({
                ...contact,
                createdBy: userId,
                client: savedClient,
              });
            }
          });
          await contactRepo.save(contactsToSave);
        } else {
          // For new client, just create contacts
          const createdContacts = secondaryContacts.map((contact) =>
            contactRepo.create({
              ...contact,
              createdBy: userId,
              client: savedClient,
            })
          );
          await contactRepo.save(createdContacts);
        }
      }

      // 4. Save pre-onboarding properties
      for (const property of clientProperties) {
        // Create ClientProperty
        const clientProperty = propertyRepo.create({
          address: property.address,
          streetAddress: property.streetAddress ?? null,
          unitNumber: property.unitNumber ?? null,
          city: property.city ?? null,
          state: property.state ?? null,
          country: property.country ?? null,
          zipCode: property.zipCode ?? null,
          latitude: property.latitude ?? null,
          longitude: property.longitude ?? null,
          status: PropertyStatus.ONBOARDING,
          client: savedClient,
          createdBy: userId,
        });
        const savedClientProperty = await propertyRepo.save(clientProperty);

        // Map Service Info
        const serviceInfoPayload = property.onboarding?.serviceInfo;
        const serviceInfoEntity = serviceInfoRepo.create({
          managementFee: serviceInfoPayload?.managementFee != null ? String(serviceInfoPayload.managementFee) : null,
          serviceType: serviceInfoPayload?.serviceType ?? null,
          serviceNotes: serviceInfoPayload?.serviceNotes ?? null,
          clientProperty: savedClientProperty,
          createdBy: userId,
        });
        await serviceInfoRepo.save(serviceInfoEntity);

        // Map Onboarding
        const sales = property.onboarding?.sales;
        const listing = property.onboarding?.listing;
        const photography = property.onboarding?.photography;
        const contractorsVendor = property.onboarding?.contractorsVendor;
        const financial = property.onboarding?.financial;

        // Get projectedRevenue from financial section first, fallback to sales for backward compatibility
        // Store as text/string as entered by user (e.g., "$50,000", "$50k", etc.)
        let projectedRevenueValue: string | null = null;

        // Check financial section first
        if (financial && financial.projectedRevenue != null && String(financial.projectedRevenue).trim() !== '') {
          const rawValue = financial.projectedRevenue;
          // Store the value as-is (trimmed) to preserve user's text format
          if (typeof rawValue === 'string') {
            projectedRevenueValue = rawValue.trim() || null;
          } else if (typeof rawValue === 'number') {
            // If it's a number, convert to string
            projectedRevenueValue = String(rawValue);
          }
        }
        // Fallback to sales section for backward compatibility
        else if (sales && sales.projectedRevenue != null) {
          // If coming from sales, convert to string (could be number from old data)
          projectedRevenueValue = String(sales.projectedRevenue);
        }

        const onboardingEntity = onboardingRepo.create({
          salesRepresentative: sales?.salesRepresentative ?? null,
          salesNotes: sales?.salesNotes ?? null,
          projectedRevenue: projectedRevenueValue,
          clientCurrentListingLink: Array.isArray(listing?.clientCurrentListingLink)
            ? JSON.stringify(listing?.clientCurrentListingLink)
            : (listing?.clientCurrentListingLink as unknown as string) ?? null,
          listingOwner: listing?.listingOwner ?? null,
          clientListingStatus: listing?.clientListingStatus ?? null,
          targetLiveDate: listing?.targetLiveDate ?? null,
          targetStartDate: listing?.targetStartDate ?? null,
          targetDateNotes: listing?.targetDateNotes ?? null,
          upcomingReservations: listing?.upcomingReservations ?? null,
          onboardingCallSchedule: listing?.onboardingCallSchedule ?? null,
          photographyCoverage: photography?.photographyCoverage ?? null,
          photographyNotes: photography?.photographyNotes ?? null,
          clientProperty: savedClientProperty,
          createdBy: userId,
        });
        await onboardingRepo.save(onboardingEntity);

        // Create PropertyInfo
        if (sales?.minPrice !== undefined || financial) {
          const propertyInfoEntity = propertyInfoRepo.create({
            minPrice: sales?.minPrice ?? null,
            claimFee: financial?.claimsFee ?? null,
            techFee: financial?.techFee ?? null,
            techFeeNotes: financial?.techFeeDetails ?? null,
            onboardingFee: financial?.onboardingFee ?? null,
            onboardingFeeAmountAndConditions: financial?.onboardingFeeDetails ?? null,
            offboardingFee: financial?.offboardingFee ?? null,
            offboardingFeeAmountAndConditions: financial?.offboardingFeeDetails ?? null,
            payoutSchdule: financial?.payoutSchedule ?? null,
            taxesAddedum: financial?.taxesAddendum ?? null,
            clientProperty: savedClientProperty,
            createdBy: userId,
          });
          const savedPropertyInfo = await propertyInfoRepo.save(propertyInfoEntity);

          // Create PropertyVendorManagement
          if (contractorsVendor) {
            const vendorManagementEntity = vendorManagementRepo.create({
              cleanerManagedBy: contractorsVendor.cleaning ?? null,
              maintenanceBy: contractorsVendor.maintenance ?? null,
              biWeeklyInspection: contractorsVendor.biWeeklyInspection ?? null,
              propertyInfo: savedPropertyInfo,
            });
            await vendorManagementRepo.save(vendorManagementEntity);
          }
        }
      }

      // 5. Update client status if properties were added (only if not already set)
      if (clientProperties.length > 0 && savedClient.status !== "active") {
        savedClient.status = "active";
        await clientRepo.save(savedClient);
      }

      // 6. Return full client with relations
      const fullClient = await clientRepo.findOne({
        where: { id: savedClient.id },
        relations: ["secondaryContacts", "properties", "properties.propertyInfo"],
      });

      // 7. Create contact in OpenPhone (non-blocking, outside transaction)
      // This is done after the transaction to avoid blocking client creation
      if (fullClient && !existingClientId) {
        this.createOpenPhoneContact(fullClient, clientProperties).catch((error) => {
          logger.error(`Failed to create OpenPhone contact for client ${savedClient.id}:`, error);
        });

        // Send onboarding call SMS if onboardingCallSchedule was set
        for (const property of clientProperties) {
          const onboardingCallSchedule = property.onboarding?.listing?.onboardingCallSchedule;
          if (onboardingCallSchedule && fullClient.properties?.length > 0) {
            // Find the saved property that matches this one (by address)
            const savedProperty = fullClient.properties.find(
              (p: any) => p.address === property.address
            );
            if (savedProperty) {
              this.sendOnboardingCallSMS(
                fullClient,
                savedProperty,
                onboardingCallSchedule,
                userId
              ).catch((error) => {
                logger.error(`Failed to send onboarding call SMS for client ${savedClient.id}:`, error);
              });
            }
          }
        }
      }

      return fullClient;
    });
  }

  /**
   * Create a contact in OpenPhone for a new client
   * This is called asynchronously after client creation to avoid blocking
   */
  private async createOpenPhoneContact(client: ClientEntity, properties: any[]): Promise<void> {
    try {
      const openPhoneService = new OpenPhoneService();
      if (!openPhoneService.isConfigured()) {
        logger.info("OpenPhone not configured, skipping contact creation");
        return;
      }
      await openPhoneService.createContactFromClient(client, properties);
      logger.info(`OpenPhone contact created successfully for client: ${client.id}`);
    } catch (error) {
      logger.error(`OpenPhone contact creation failed for client ${client.id}:`, error);
      // Don't throw - we don't want to affect the main flow
    }
  }

  /**
   * Send onboarding call SMS to client
   * Called when onboardingCallSchedule is first set
   */
  private async sendOnboardingCallSMS(
    client: ClientEntity,
    clientProperty: ClientPropertyEntity,
    onboardingCallSchedule: string,
    userId: string
  ): Promise<void> {
    try {
      const openPhoneService = new OpenPhoneService();
      if (!openPhoneService.isConfigured()) {
        logger.info("OpenPhone not configured, skipping onboarding call SMS");
        return;
      }

      // Get API key for the user
      const usersService = new UsersService();
      const apiKeyResult = await usersService.getApiKey(userId);
      const apiKey = apiKeyResult.apiKey;

      // Build the onboarding form URL
      const baseUrl = "https://securestay.ai";
      const onboardingFormLink = `${baseUrl}/client-listing-intake-update/${apiKey}/${client.id}?propertyId=${clientProperty.id}`;

      // Send the SMS
      await openPhoneService.sendOnboardingCallSMS(
        client.firstName || "there",
        client.dialCode || "+1",
        client.phone || "",
        onboardingCallSchedule,
        onboardingFormLink
      );

      logger.info(`Onboarding call SMS sent successfully for client: ${client.id}`);
    } catch (error) {
      logger.error(`Failed to send onboarding call SMS for client ${client.id}:`, error);
      // Don't throw - we don't want to affect the main flow
    }
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
        streetAddress: property.streetAddress ?? null,
        unitNumber: property.unitNumber ?? null,
        city: property.city ?? null,
        state: property.state ?? null,
        country: property.country ?? null,
        zipCode: property.zipCode ?? null,
        latitude: property.latitude ?? null,
        longitude: property.longitude ?? null,
        status: PropertyStatus.ONBOARDING,
        client: { id: clientId } as any,
        createdBy: userId,
      });
      const savedClientProperty = await this.propertyRepo.save(clientProperty);

      // Map Service Info
      const serviceInfoPayload = property.onboarding?.serviceInfo;
      const serviceInfoEntity = this.propertyServiceInfoRepo.create({
        managementFee: serviceInfoPayload?.managementFee != null ? String(serviceInfoPayload.managementFee) : null,
        serviceType: serviceInfoPayload?.serviceType ?? null,
        serviceNotes: serviceInfoPayload?.serviceNotes ?? null,
        clientProperty: savedClientProperty,
        createdBy: userId,
      });
      const savedServiceInfo = await this.propertyServiceInfoRepo.save(serviceInfoEntity);

      // Map Onboarding (sales, listing, photography, contractors, financial)
      const sales = property.onboarding?.sales;
      const listing = property.onboarding?.listing;
      const photography = property.onboarding?.photography;
      const contractorsVendor = property.onboarding?.contractorsVendor;
      const financial = property.onboarding?.financial;

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
        onboardingCallSchedule: listing?.onboardingCallSchedule ?? null,
        // photography
        photographyCoverage: photography?.photographyCoverage ?? null,
        photographyNotes: photography?.photographyNotes ?? null,
        // relations/meta
        clientProperty: savedClientProperty,
        createdBy: userId,
      });
      const savedOnboarding = await this.propertyOnboardingRepo.save(onboardingEntity);

      // Create PropertyInfo record to store minPrice from sales and financial data
      if (sales?.minPrice !== undefined || financial) {
        const propertyInfoEntity = this.propertyInfoRepo.create({
          minPrice: sales?.minPrice ?? null,
          claimFee: financial?.claimsFee ?? null,
          techFee: financial?.techFee ?? null,
          techFeeNotes: financial?.techFeeDetails ?? null,
          onboardingFee: financial?.onboardingFee ?? null,
          onboardingFeeAmountAndConditions: financial?.onboardingFeeDetails ?? null,
          offboardingFee: financial?.offboardingFee ?? null,
          offboardingFeeAmountAndConditions: financial?.offboardingFeeDetails ?? null,
          payoutSchdule: financial?.payoutSchedule ?? null,
          taxesAddedum: financial?.taxesAddendum ?? null,
          clientProperty: savedClientProperty,
          createdBy: userId,
        });
        const savedPropertyInfo = await this.propertyInfoRepo.save(propertyInfoEntity);

        // Create PropertyVendorManagement record if contractors/vendor data is provided
        if (contractorsVendor) {
          const vendorManagementEntity = this.propertyVendorManagementRepo.create({
            cleanerManagedBy: contractorsVendor.cleaning ?? null,
            maintenanceBy: contractorsVendor.maintenance ?? null,
            biWeeklyInspection: contractorsVendor.biWeeklyInspection ?? null,
            propertyInfo: savedPropertyInfo,
          });
          await this.propertyVendorManagementRepo.save(vendorManagementEntity);
        }
      }

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
      .leftJoinAndSelect("cp.propertyInfo", "propertyInfo")
      .leftJoinAndSelect("propertyInfo.vendorManagementInfo", "vendorManagementInfo")
      .where("cp.clientId = :clientId", { clientId })
      .andWhere("cp.deletedAt IS NULL")
      .getMany();

    const data = clientProperties.map((cp) => {
      const si = cp.serviceInfo;
      const ob = cp.onboarding;
      const pi = cp.propertyInfo;
      const vm = pi?.vendorManagementInfo;

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
        streetAddress: cp.streetAddress ?? null,
        unitNumber: cp.unitNumber ?? null,
        city: cp.city ?? null,
        state: cp.state ?? null,
        country: cp.country ?? null,
        zipCode: cp.zipCode ?? null,
        latitude: cp.latitude ?? null,
        longitude: cp.longitude ?? null,
        onboarding: {
          serviceInfo: si
            ? {
              managementFee: si.managementFee != null ? Number(si.managementFee) : null,
              serviceType: si.serviceType ?? null,
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
              onboardingCallSchedule: ob.onboardingCallSchedule ?? null,
            }
            : null,
          photography: ob
            ? {
              photographyCoverage: ob.photographyCoverage ?? null,
              photographyNotes: ob.photographyNotes ?? null,
            }
            : null,
          contractorsVendor: vm
            ? {
              cleaning: vm.cleanerManagedBy ?? null,
              maintenance: vm.maintenanceBy ?? null,
              biWeeklyInspection: vm.biWeeklyInspection ?? null,
            }
            : null,
          financial: pi
            ? {
              claimsFee: pi.claimFee ?? null,
              techFee: pi.techFee ?? null,
              techFeeDetails: pi.techFeeNotes ?? null,
              onboardingFee: pi.onboardingFee ?? null,
              onboardingFeeDetails: pi.onboardingFeeAmountAndConditions ?? null,
              offboardingFee: pi.offboardingFee ?? null,
              offboardingFeeDetails: pi.offboardingFeeAmountAndConditions ?? null,
              payoutSchedule: pi.payoutSchdule ?? null,
              taxesAddendum: pi.taxesAddedum ?? null,
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
        clientProperty = await this.propertyRepo.findOne({ 
          where: { id: property.id }, 
          relations: ["onboarding", "serviceInfo", "propertyInfo", "propertyInfo.vendorManagementInfo"] 
        });
        if (!clientProperty) {
          throw CustomErrorHandler.notFound(`Client property not found: ${property.id}`);
        }
        if ((clientProperty.client as any)?.id && (clientProperty.client as any).id !== clientId) {
          throw CustomErrorHandler.validationError("Property does not belong to provided clientId");
        }

        if (property.address !== undefined) {
          clientProperty.address = property.address;
        }
        if (property.streetAddress !== undefined) {
          clientProperty.streetAddress = property.streetAddress;
        }
        if (property.unitNumber !== undefined) {
          clientProperty.unitNumber = property.unitNumber;
        }
        if (property.city !== undefined) {
          clientProperty.city = property.city;
        }
        if (property.state !== undefined) {
          clientProperty.state = property.state;
        }
        if (property.country !== undefined) {
          clientProperty.country = property.country;
        }
        if (property.zipCode !== undefined) {
          clientProperty.zipCode = property.zipCode;
        }
        if (property.latitude !== undefined) {
          clientProperty.latitude = property.latitude;
        }
        if (property.longitude !== undefined) {
          clientProperty.longitude = property.longitude;
        }
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      } else {
        // Create new property
        clientProperty = this.propertyRepo.create({
          address: property.address,
          streetAddress: property.streetAddress ?? null,
          unitNumber: property.unitNumber ?? null,
          city: property.city ?? null,
          state: property.state ?? null,
          country: property.country ?? null,
          zipCode: property.zipCode ?? null,
          latitude: property.latitude ?? null,
          longitude: property.longitude ?? null,
          status: PropertyStatus.ONBOARDING,
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
            serviceNotes: siPayload.serviceNotes ?? null
          });
        } else {
          if (siPayload.managementFee !== undefined) si.managementFee = siPayload.managementFee != null ? String(siPayload.managementFee) : null;
          if (siPayload.serviceType !== undefined) si.serviceType = siPayload.serviceType ?? null;
          if (siPayload.serviceNotes !== undefined) si.serviceNotes = siPayload.serviceNotes ?? null;
          si.updatedBy = userId;
        }
        await this.propertyServiceInfoRepo.save(si);
      }

      // Update or Create Onboarding if provided
      const sales = property.onboarding?.sales;
      const listing = property.onboarding?.listing;
      const photography = property.onboarding?.photography;
      const contractorsVendor = property.onboarding?.contractorsVendor;
      const financial = property.onboarding?.financial;

      if (sales || listing || photography) {

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
            onboardingCallSchedule: listing?.onboardingCallSchedule ?? null,
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
            if (listing.onboardingCallSchedule !== undefined) ob.onboardingCallSchedule = listing.onboardingCallSchedule ?? null;
          }

          if (photography) {
            if (photography.photographyCoverage !== undefined) ob.photographyCoverage = photography.photographyCoverage ?? null;
            if (photography.photographyNotes !== undefined) ob.photographyNotes = photography.photographyNotes ?? null;
          }

          ob.updatedBy = userId;
        }

        await this.propertyOnboardingRepo.save(ob);
      }

      // Handle minPrice from sales and financial data - create or update PropertyInfo
      if (sales?.minPrice !== undefined || financial || contractorsVendor) {
        let propertyInfo = clientProperty.propertyInfo;
        if (!propertyInfo) {
          // Create new PropertyInfo record
          propertyInfo = this.propertyInfoRepo.create({
            minPrice: sales?.minPrice ?? null,
            claimFee: financial?.claimsFee ?? null,
            techFee: financial?.techFee ?? null,
            techFeeNotes: financial?.techFeeDetails ?? null,
            onboardingFee: financial?.onboardingFee ?? null,
            onboardingFeeAmountAndConditions: financial?.onboardingFeeDetails ?? null,
            offboardingFee: financial?.offboardingFee ?? null,
            offboardingFeeAmountAndConditions: financial?.offboardingFeeDetails ?? null,
            payoutSchdule: financial?.payoutSchedule ?? null,
            taxesAddedum: financial?.taxesAddendum ?? null,
            clientProperty: clientProperty,
            createdBy: userId,
          });
        } else {
          // Update existing PropertyInfo record
          if (sales?.minPrice !== undefined) propertyInfo.minPrice = sales.minPrice;
          if (financial?.claimsFee !== undefined) propertyInfo.claimFee = financial.claimsFee ?? null;
          if (financial?.techFee !== undefined) propertyInfo.techFee = financial.techFee ?? null;
          if (financial?.techFeeDetails !== undefined) propertyInfo.techFeeNotes = financial.techFeeDetails ?? null;
          if (financial?.onboardingFee !== undefined) propertyInfo.onboardingFee = financial.onboardingFee ?? null;
          if (financial?.onboardingFeeDetails !== undefined) propertyInfo.onboardingFeeAmountAndConditions = financial.onboardingFeeDetails ?? null;
          if (financial?.offboardingFee !== undefined) propertyInfo.offboardingFee = financial.offboardingFee ?? null;
          if (financial?.offboardingFeeDetails !== undefined) propertyInfo.offboardingFeeAmountAndConditions = financial.offboardingFeeDetails ?? null;
          if (financial?.payoutSchedule !== undefined) propertyInfo.payoutSchdule = financial.payoutSchedule ?? null;
          if (financial?.taxesAddendum !== undefined) propertyInfo.taxesAddedum = financial.taxesAddendum ?? null;
          propertyInfo.updatedBy = userId;
        }
        const savedPropertyInfo = await this.propertyInfoRepo.save(propertyInfo);

        // Handle PropertyVendorManagement
        if (contractorsVendor) {
          let vendorManagement = propertyInfo.vendorManagementInfo;
          if (!vendorManagement) {
            // Create new PropertyVendorManagement record
            vendorManagement = this.propertyVendorManagementRepo.create({
              cleanerManagedBy: contractorsVendor.cleaning ?? null,
              maintenanceBy: contractorsVendor.maintenance ?? null,
              biWeeklyInspection: contractorsVendor.biWeeklyInspection ?? null,
              propertyInfo: savedPropertyInfo,
            });
          } else {
            // Update existing PropertyVendorManagement record
            if (contractorsVendor.cleaning !== undefined) vendorManagement.cleanerManagedBy = contractorsVendor.cleaning ?? null;
            if (contractorsVendor.maintenance !== undefined) vendorManagement.maintenanceBy = contractorsVendor.maintenance ?? null;
            if (contractorsVendor.biWeeklyInspection !== undefined) vendorManagement.biWeeklyInspection = contractorsVendor.biWeeklyInspection ?? null;
          }
          await this.propertyVendorManagementRepo.save(vendorManagement);
        }
      }

      // Refresh the property to get the latest data with relations
      const propertyId = property.id || clientProperty.id;
      const refreshed = await this.propertyRepo.findOne({ 
        where: { id: propertyId }, 
        relations: ["onboarding", "serviceInfo", "propertyInfo", "propertyInfo.vendorManagementInfo"] 
      });
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
        clientProperty.streetAddress = property.streetAddress ?? null;
        clientProperty.unitNumber = property.unitNumber ?? null;
        clientProperty.city = property.city ?? null;
        clientProperty.state = property.state ?? null;
        clientProperty.country = property.country ?? null;
        clientProperty.zipCode = property.zipCode ?? null;
        clientProperty.latitude = property.latitude ?? null;
        clientProperty.longitude = property.longitude ?? null;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        clientProperty = await this.propertyRepo.save(clientProperty);
      } else {
        // Create new property
        clientProperty = this.propertyRepo.create({
          address: property.address,
          streetAddress: property.streetAddress ?? null,
          unitNumber: property.unitNumber ?? null,
          city: property.city ?? null,
          state: property.state ?? null,
          country: property.country ?? null,
          zipCode: property.zipCode ?? null,
          latitude: property.latitude ?? null,
          longitude: property.longitude ?? null,
          client: { id: clientId } as any,
          createdBy: userId,
          status: PropertyStatus.ONBOARDING,
        });
        clientProperty = await this.propertyRepo.save(clientProperty);
      }

      // Map Onboarding (sales, listing, photography) - no serviceInfo for internal onboarding
      const sales = property.onboarding?.sales;
      const listing = property.onboarding?.listing;
      const photography = property.onboarding?.photography;
      const clientAcknowledgement = property.onboarding.clientAcknowledgement;

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
        if (listing.onboardingCallSchedule !== undefined) onboardingEntity.onboardingCallSchedule = listing.onboardingCallSchedule ?? null;
      }

      if (photography) {
        if (photography.photographyCoverage !== undefined) onboardingEntity.photographyCoverage = photography.photographyCoverage ?? null;
        if (photography.photographyNotes !== undefined) onboardingEntity.photographyNotes = photography.photographyNotes ?? null;
      }

      if (clientAcknowledgement) {
        if (clientAcknowledgement.acknowledgePropertyReadyByStartDate !== undefined) onboardingEntity.acknowledgePropertyReadyByStartDate = clientAcknowledgement.acknowledgePropertyReadyByStartDate ?? false;
        if (clientAcknowledgement.acknowledgesResponsibilityToInform !== undefined) onboardingEntity.acknowledgesResponsibilityToInform = clientAcknowledgement.acknowledgesResponsibilityToInform ?? false;
        if (clientAcknowledgement.agreesUnpublishExternalListings !== undefined) onboardingEntity.agreesUnpublishExternalListings = clientAcknowledgement.agreesUnpublishExternalListings ?? false;
      }

      onboardingEntity.updatedBy = userId;
      const savedOnboarding = await this.propertyOnboardingRepo.save(onboardingEntity);

      results.push({ clientProperty, onboarding: savedOnboarding });
    }

    return { message: "Internal onboarding details saved", results };
  }

  async updatedOnboardingDetails(body: PropertyOnboardingRequest, userId: string) {
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

        if (property.address !== undefined) {
          clientProperty.address = property.address;
        }
        if (property.streetAddress !== undefined) {
          clientProperty.streetAddress = property.streetAddress ?? null;
        }
        if (property.unitNumber !== undefined) {
          clientProperty.unitNumber = property.unitNumber ?? null;
        }
        if (property.city !== undefined) {
          clientProperty.city = property.city ?? null;
        }
        if (property.state !== undefined) {
          clientProperty.state = property.state ?? null;
        }
        if (property.country !== undefined) {
          clientProperty.country = property.country ?? null;
        }
        if (property.zipCode !== undefined) {
          clientProperty.zipCode = property.zipCode ?? null;
        }
        if (property.latitude !== undefined) {
          clientProperty.latitude = property.latitude ?? null;
        }
        if (property.longitude !== undefined) {
          clientProperty.longitude = property.longitude ?? null;
        }
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      } else {
        // Create new property
        clientProperty = this.propertyRepo.create({
          address: property.address,
          streetAddress: property.streetAddress ?? null,
          unitNumber: property.unitNumber ?? null,
          city: property.city ?? null,
          state: property.state ?? null,
          country: property.country ?? null,
          zipCode: property.zipCode ?? null,
          latitude: property.latitude ?? null,
          longitude: property.longitude ?? null,
          client: { id: clientId } as any,
          createdBy: userId,
          status: PropertyStatus.ONBOARDING,
        });
        clientProperty = await this.propertyRepo.save(clientProperty);
      }

      // Update Onboarding if provided (no serviceInfo for internal onboarding)
      if (property.onboarding?.sales || property.onboarding?.listing || property.onboarding?.photography || property.onboarding?.clientAcknowledgement) {
        const sales = property.onboarding.sales;
        const listing = property.onboarding.listing;
        const photography = property.onboarding.photography;
        const clientAcknowledgement = property.onboarding.clientAcknowledgement;

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
          if (listing.onboardingCallSchedule !== undefined) ob.onboardingCallSchedule = listing.onboardingCallSchedule ?? null;
        }

        if (photography) {
          if (photography.photographyCoverage !== undefined) ob.photographyCoverage = photography.photographyCoverage ?? null;
          if (photography.photographyNotes !== undefined) ob.photographyNotes = photography.photographyNotes ?? null;
        }

        if (clientAcknowledgement) {
          if (clientAcknowledgement.acknowledgePropertyReadyByStartDate !== undefined) ob.acknowledgePropertyReadyByStartDate = clientAcknowledgement.acknowledgePropertyReadyByStartDate ?? false;
          if (clientAcknowledgement.acknowledgesResponsibilityToInform !== undefined) ob.acknowledgesResponsibilityToInform = clientAcknowledgement.acknowledgesResponsibilityToInform ?? false;
          if (clientAcknowledgement.agreesUnpublishExternalListings !== undefined) ob.agreesUnpublishExternalListings = clientAcknowledgement.agreesUnpublishExternalListings ?? false;
        }

        ob.updatedBy = userId;
        await this.propertyOnboardingRepo.save(ob);
      }

      const refreshed = await this.propertyRepo.findOne({ where: { id: clientProperty.id }, relations: ["onboarding"] });
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

  async getClientDetails(id: string, propertyId: string[]) {
    const query = this.clientRepo.createQueryBuilder("client")
      .leftJoinAndSelect("client.properties", "property")
      .leftJoinAndSelect("client.secondaryContacts", "secondaryContacts")
      .leftJoinAndSelect("property.onboarding", "onboarding")
      .leftJoinAndSelect("property.serviceInfo", "serviceInfo")
      .leftJoinAndSelect("property.propertyInfo", "propertyInfo")
      .leftJoinAndSelect("propertyInfo.propertyBedTypes", "propertyBedTypes")
      .leftJoinAndSelect("propertyInfo.propertyBathroomLocation", "propertyBathroomLocation")
      .leftJoinAndSelect("propertyInfo.propertyUpsells", "propertyUpsells")
      .leftJoinAndSelect("propertyInfo.propertyParkingInfo", "propertyParkingInfo")
      .leftJoinAndSelect("propertyInfo.vendorManagementInfo", "vendorManagementInfo")
      .leftJoinAndSelect("vendorManagementInfo.suppliesToRestock", "suppliesToRestock")
      .leftJoinAndSelect("vendorManagementInfo.vendorInfo", "vendorInfo")
      .where("client.id = :id", { id });

    if (propertyId && propertyId.length > 0) {
      query.andWhere("property.id IN (:...propertyIds)", { propertyIds: propertyId });
    }

    return await query.getOne();
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
    if (listingPayload.unitFloor !== undefined) propertyInfo.unitFloor = listingPayload.unitFloor ?? null;
    if (listingPayload.squareMeters !== undefined) propertyInfo.squareMeters = listingPayload.squareMeters ?? null;
    if (listingPayload.squareFeet !== undefined) {
      propertyInfo.squareFeet = listingPayload.squareFeet ?? null;
      // If squareFeet is provided, also calculate and save squareMeters (1 sqft = 0.092903 sqm)
      if (listingPayload.squareFeet !== null) {
        propertyInfo.squareMeters = Math.round(listingPayload.squareFeet * 0.092903 * 100) / 100;
      }
    } else if (listingPayload.squareMeters !== null && listingPayload.squareMeters !== undefined && !listingPayload.squareFeet) {
      // If only squareMeters is provided, calculate squareFeet (1 sqm = 10.7639 sqft)
      propertyInfo.squareFeet = Math.round(listingPayload.squareMeters * 10.7639);
    }
    if (listingPayload.personCapacity !== undefined) propertyInfo.personCapacity = listingPayload.personCapacity ?? null;
    if (listingPayload.chargeForExtraGuests !== undefined) propertyInfo.chargeForExtraGuests = listingPayload.chargeForExtraGuests ?? null;
    if (listingPayload.guestsIncluded !== undefined) propertyInfo.guestsIncluded = listingPayload.guestsIncluded ?? null;
    if (listingPayload.priceForExtraPerson !== undefined) propertyInfo.priceForExtraPerson = listingPayload.priceForExtraPerson ?? null;
    if (listingPayload.extraGuestFeeType !== undefined) propertyInfo.extraGuestFeeType = listingPayload.extraGuestFeeType ?? null;

    // Bedrooms
    if (listingPayload.roomType !== undefined) propertyInfo.roomType = listingPayload.roomType ?? null;
    if (listingPayload.bedroomsNumber !== undefined) propertyInfo.bedroomsNumber = listingPayload.bedroomsNumber ?? null;
    if (listingPayload.bedroomNotes !== undefined) propertyInfo.bedroomNotes = listingPayload.bedroomNotes ?? null;

    // Bathrooms
    if (listingPayload.bathroomType !== undefined) propertyInfo.bathroomType = listingPayload.bathroomType ?? null;
    if (listingPayload.bathroomsNumber !== undefined) propertyInfo.bathroomsNumber = listingPayload.bathroomsNumber ?? null;
    if (listingPayload.guestBathroomsNumber !== undefined) propertyInfo.guestBathroomsNumber = listingPayload.guestBathroomsNumber ?? null;
    if (listingPayload.bathroomNotes !== undefined) propertyInfo.bathroomNotes = listingPayload.bathroomNotes ?? null;

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
    if (listingPayload.petFeeType !== undefined) propertyInfo.petFeeType = listingPayload.petFeeType ?? null;
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
    if (listingPayload.emergencyBackUpCode !== undefined) propertyInfo.emergencyBackUpCode = listingPayload.emergencyBackUpCode ?? null;

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
    if (listingPayload.acknowledgeNoGuestContact !== undefined) propertyInfo.acknowledgeNoGuestContact = listingPayload.acknowledgeNoGuestContact ?? null;
    if (listingPayload.acknowledgeNoPropertyAccess !== undefined) propertyInfo.acknowledgeNoPropertyAccess = listingPayload.acknowledgeNoPropertyAccess ?? null;
    if (listingPayload.acknowledgeNoDirectTransactions !== undefined) propertyInfo.acknowledgeNoDirectTransactions = listingPayload.acknowledgeNoDirectTransactions ?? null;

    //Financials
    if (listingPayload.minPrice !== undefined) propertyInfo.minPrice = listingPayload.minPrice ?? null;
    if (listingPayload.minPriceWeekday !== undefined) propertyInfo.minPriceWeekday = listingPayload.minPriceWeekday ?? null;
    if (listingPayload.minPriceWeekend !== undefined) propertyInfo.minPriceWeekend = listingPayload.minPriceWeekend ?? null;
    if (listingPayload.minNights !== undefined) propertyInfo.minNights = listingPayload.minNights ?? null;
    if (listingPayload.minNightsWeekday !== undefined) propertyInfo.minNightsWeekday = listingPayload.minNightsWeekday ?? null;
    if (listingPayload.minNightsWeekend !== undefined) propertyInfo.minNightsWeekend = listingPayload.minNightsWeekend ?? null;
    if (listingPayload.maxNights !== undefined) propertyInfo.maxNights = listingPayload.maxNights ?? null;
    if (listingPayload.pricingStrategyPreference !== undefined) propertyInfo.pricingStrategyPreference = listingPayload.pricingStrategyPreference ?? null;
    if (listingPayload.minimumNightsRequiredByLaw !== undefined) propertyInfo.minimumNightsRequiredByLaw = listingPayload.minimumNightsRequiredByLaw ?? null;
    if (listingPayload.propertyLicenseNumber !== undefined) propertyInfo.propertyLicenseNumber = listingPayload.propertyLicenseNumber ?? null;
    if (listingPayload.tax !== undefined) propertyInfo.tax = listingPayload.tax ?? null;
    if (listingPayload.financialNotes !== undefined) propertyInfo.financialNotes = listingPayload.financialNotes ?? null;

    // Standard Booking Settings
    if (listingPayload.instantBooking !== undefined) propertyInfo.instantBooking = listingPayload.instantBooking ?? null;
    if (listingPayload.instantBookingNotes !== undefined) propertyInfo.instantBookingNotes = listingPayload.instantBookingNotes ?? null;
    if (listingPayload.minimumAdvanceNotice !== undefined) propertyInfo.minimumAdvanceNotice = listingPayload.minimumAdvanceNotice ?? null;
    if (listingPayload.minimumAdvanceNoticeNotes !== undefined) propertyInfo.minimumAdvanceNoticeNotes = listingPayload.minimumAdvanceNoticeNotes ?? null;
    if (listingPayload.preparationDays !== undefined) propertyInfo.preparationDays = listingPayload.preparationDays ?? null;
    if (listingPayload.preparationDaysNotes !== undefined) propertyInfo.preparationDaysNotes = listingPayload.preparationDaysNotes ?? null;
    if (listingPayload.bookingWindow !== undefined) propertyInfo.bookingWindow = listingPayload.bookingWindow ?? null;
    if (listingPayload.bookingWindowNotes !== undefined) propertyInfo.bookingWindowNotes = listingPayload.bookingWindowNotes ?? null;
    if (listingPayload.minimumStay !== undefined) propertyInfo.minimumStay = listingPayload.minimumStay ?? null;
    if (listingPayload.minimumStayNotes !== undefined) propertyInfo.minimumStayNotes = listingPayload.minimumStayNotes ?? null;
    if (listingPayload.maximumStay !== undefined) propertyInfo.maximumStay = listingPayload.maximumStay ?? null;
    if (listingPayload.maximumStayNotes !== undefined) propertyInfo.maximumStayNotes = listingPayload.maximumStayNotes ?? null;

    // Amenities
    if (listingPayload.amenities !== undefined) propertyInfo.amenities = listingPayload.amenities ?? null;
    if (listingPayload.acknowledgeAmenitiesAccurate !== undefined) propertyInfo.acknowledgeAmenitiesAccurate = listingPayload.acknowledgeAmenitiesAccurate ?? null;
    if (listingPayload.acknowledgeSecurityCamerasDisclosed !== undefined) propertyInfo.acknowledgeSecurityCamerasDisclosed = listingPayload.acknowledgeSecurityCamerasDisclosed ?? null;
    if (listingPayload.wifiAvailable !== undefined) propertyInfo.wifiAvailable = listingPayload.wifiAvailable ?? null;
    if (listingPayload.wifiUsername !== undefined) propertyInfo.wifiUsername = listingPayload.wifiUsername ?? null;
    if (listingPayload.wifiPassword !== undefined) propertyInfo.wifiPassword = listingPayload.wifiPassword ?? null;
    if (listingPayload.wifiSpeed !== undefined) propertyInfo.wifiSpeed = listingPayload.wifiSpeed ?? null;
    if (listingPayload.locationOfModem !== undefined) propertyInfo.locationOfModem = listingPayload.locationOfModem ?? null;
    if (listingPayload.ethernetCable !== undefined) propertyInfo.ethernetCable = listingPayload.ethernetCable ?? null;
    if (listingPayload.pocketWifi !== undefined) propertyInfo.pocketWifi = listingPayload.pocketWifi ?? null;
    if (listingPayload.paidWifi !== undefined) propertyInfo.paidWifi = listingPayload.paidWifi ?? null;
    if (listingPayload.swimmingPoolNotes !== undefined) propertyInfo.swimmingPoolNotes = listingPayload.swimmingPoolNotes ?? null;
    if (listingPayload.hotTubInstructions !== undefined) propertyInfo.hotTubInstructions = listingPayload.hotTubInstructions ?? null;
    if (listingPayload.firePlaceNotes !== undefined) propertyInfo.firePlaceNotes = listingPayload.firePlaceNotes ?? null;
    if (listingPayload.firepitNotes !== undefined) propertyInfo.firepitNotes = listingPayload.firepitNotes ?? null;
    if (listingPayload.firepitType !== undefined) propertyInfo.firepitType = listingPayload.firepitType ?? null;
    if (listingPayload.gameConsoleType !== undefined) propertyInfo.gameConsoleType = listingPayload.gameConsoleType ?? null;
    if (listingPayload.gameConsoleNotes !== undefined) propertyInfo.gameConsoleNotes = listingPayload.gameConsoleNotes ?? null;
    if (listingPayload.safeBoxLocationInstructions !== undefined) propertyInfo.safeBoxLocationInstructions = listingPayload.safeBoxLocationInstructions ?? null;
    if (listingPayload.gymPrivacy !== undefined) propertyInfo.gymPrivacy = listingPayload.gymPrivacy ?? null;
    if (listingPayload.gymNotes !== undefined) propertyInfo.gymNotes = listingPayload.gymNotes ?? null;
    if (listingPayload.saunaPrivacy !== undefined) propertyInfo.saunaPrivacy = listingPayload.saunaPrivacy ?? null;
    if (listingPayload.saunaNotes !== undefined) propertyInfo.saunaNotes = listingPayload.saunaNotes ?? null;
    if (listingPayload.exerciseEquipmentTypes !== undefined) propertyInfo.exerciseEquipmentTypes = listingPayload.exerciseEquipmentTypes ? JSON.stringify(listingPayload.exerciseEquipmentTypes) : null;
    if (listingPayload.exerciseEquipmentNotes !== undefined) propertyInfo.exerciseEquipmentNotes = listingPayload.exerciseEquipmentNotes ?? null;
    if (listingPayload.golfType !== undefined) propertyInfo.golfType = listingPayload.golfType ?? null;
    if (listingPayload.golfNotes !== undefined) propertyInfo.golfNotes = listingPayload.golfNotes ?? null;
    if (listingPayload.basketballPrivacy !== undefined) propertyInfo.basketballPrivacy = listingPayload.basketballPrivacy ?? null;
    if (listingPayload.basketballNotes !== undefined) propertyInfo.basketballNotes = listingPayload.basketballNotes ?? null;
    if (listingPayload.tennisPrivacy !== undefined) propertyInfo.tennisPrivacy = listingPayload.tennisPrivacy ?? null;
    if (listingPayload.tennisNotes !== undefined) propertyInfo.tennisNotes = listingPayload.tennisNotes ?? null;
    if (listingPayload.workspaceLocation !== undefined) propertyInfo.workspaceLocation = listingPayload.workspaceLocation ?? null;
    if (listingPayload.workspaceInclusion !== undefined) propertyInfo.workspaceInclusion = listingPayload.workspaceInclusion ? JSON.stringify(listingPayload.workspaceInclusion) : null;
    if (listingPayload.workspaceNotes !== undefined) propertyInfo.workspaceNotes = listingPayload.workspaceNotes ?? null;
    if (listingPayload.boatDockPrivacy !== undefined) propertyInfo.boatDockPrivacy = listingPayload.boatDockPrivacy ?? null;
    if (listingPayload.boatDockNotes !== undefined) propertyInfo.boatDockNotes = listingPayload.boatDockNotes ?? null;
    if (listingPayload.heatControlInstructions !== undefined) propertyInfo.heatControlInstructions = listingPayload.heatControlInstructions ?? null;
    if (listingPayload.locationOfThemostat !== undefined) propertyInfo.locationOfThemostat = listingPayload.locationOfThemostat ?? null;
    if (listingPayload.securityCameraLocations !== undefined) propertyInfo.securityCameraLocations = listingPayload.securityCameraLocations ?? null;
    if (listingPayload.carbonMonoxideDetectorLocation !== undefined) propertyInfo.carbonMonoxideDetectorLocation = listingPayload.carbonMonoxideDetectorLocation ?? null;
    if (listingPayload.smokeDetectorLocation !== undefined) propertyInfo.smokeDetectorLocation = listingPayload.smokeDetectorLocation ?? null;
    if (listingPayload.fireExtinguisherLocation !== undefined) propertyInfo.fireExtinguisherLocation = listingPayload.fireExtinguisherLocation ?? null;
    if (listingPayload.firstAidKitLocation !== undefined) propertyInfo.firstAidKitLocation = listingPayload.firstAidKitLocation ?? null;
    if (listingPayload.emergencyExitLocation !== undefined) propertyInfo.emergencyExitLocation = listingPayload.emergencyExitLocation ?? null;
  }

  private async handlePropertyBedTypes(propertyInfo: PropertyInfo, bedTypesData: any[]) {
    // Get existing bed types for this property
    const existingBedTypes = await this.propertyBedTypesRepo.find({
      where: { propertyId: { id: propertyInfo.id } }
    });

    // Delete all existing bed types for this property (easier than trying to match)
    if (existingBedTypes.length > 0) {
      await this.propertyBedTypesRepo.remove(existingBedTypes);
    }

    // Flatten the new grouped format into individual database rows
    for (const bedroomData of bedTypesData) {
      const { bedroomNumber, floorLevel, beds } = bedroomData;

      // Skip if no beds array or empty
      if (!beds || !Array.isArray(beds) || beds.length === 0) {
        continue;
      }

      // Create a separate database row for each bed type in this bedroom
      for (const bedConfig of beds) {
        const { bedTypeId, quantity, airMattressSize, upperBunkSize, lowerBunkSize } = bedConfig;

        // Skip if bedTypeId is missing
        if (!bedTypeId) {
          continue;
        }

      // Create new bed type entry
        const newBedType = this.propertyBedTypesRepo.create({
          floorLevel: floorLevel != null ? Number(floorLevel) : null,
          bedroomNumber: bedroomNumber,
          bedTypeId: bedTypeId,
          quantity: quantity ?? 1,
          airMattressSize: airMattressSize ?? null,
          upperBunkSize: upperBunkSize ?? null,
          lowerBunkSize: lowerBunkSize ?? null,
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
          if (upsellData.notes !== undefined) existingUpsell.notes = upsellData.notes ?? null;
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
          notes: upsellData.notes ?? null,
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
      if (p.parkingFeeType !== undefined) row.parkingFeeType = p.parkingFeeType ?? null as any;
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

    // Maintenance
    if (vendorPayload.maintenanceManagedBy !== undefined) vm.maintenanceManagedBy = vendorPayload.maintenanceManagedBy ?? null;
    if (vendorPayload.maintenanceManagedByReason !== undefined) vm.maintenanceManagedByReason = vendorPayload.maintenanceManagedByReason ?? null;

    // Cleaner
    if (vendorPayload.cleanerManagedBy !== undefined) vm.cleanerManagedBy = vendorPayload.cleanerManagedBy ?? null;
    if (vendorPayload.cleanerManagedByReason !== undefined) vm.cleanerManagedByReason = vendorPayload.cleanerManagedByReason ?? null;
    if (vendorPayload.hasCurrentCleaner !== undefined) vm.hasCurrentCleaner = vendorPayload.hasCurrentCleaner ?? null;
    if (vendorPayload.hasCurrentCleanerReason !== undefined) vm.hasCurrentCleanerReason = vendorPayload.hasCurrentCleanerReason ?? null;
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
    if (vendorPayload.requestCalendarAccessForCleaner !== undefined) vm.requestCalendarAccessForCleaner = vendorPayload.requestCalendarAccessForCleaner ?? null;
    if (vendorPayload.requestCalendarAccessForCleanerReason !== undefined) vm.requestCalendarAccessForCleanerReason = vendorPayload.requestCalendarAccessForCleanerReason ?? null;
    if (vendorPayload.cleaningTurnoverNotes !== undefined) vm.cleaningTurnoverNotes = vendorPayload.cleaningTurnoverNotes ?? null;

    // Restocking supplies policy
    if (vendorPayload.restockingSuppliesManagedBy !== undefined) vm.restockingSuppliesManagedBy = vendorPayload.restockingSuppliesManagedBy ?? null;
    if (vendorPayload.restockingSuppliesManagedByReason !== undefined) vm.restockingSuppliesManagedByReason = vendorPayload.restockingSuppliesManagedByReason ?? null;
    if (vendorPayload.supplyClosetLocation !== undefined) vm.supplyClosetLocation = vendorPayload.supplyClosetLocation ?? null;
    if (vendorPayload.supplyClosetCode !== undefined) vm.supplyClosetCode = vendorPayload.supplyClosetCode ?? null;
    if (vendorPayload.luxuryLodgingRestockWithoutApproval !== undefined) vm.luxuryLodgingRestockWithoutApproval = vendorPayload.luxuryLodgingRestockWithoutApproval ?? null;
    if (vendorPayload.luxuryLodgingConfirmBeforePurchase !== undefined) vm.luxuryLodgingConfirmBeforePurchase = vendorPayload.luxuryLodgingConfirmBeforePurchase ?? null;

    // Other
    if (vendorPayload.addtionalVendorManagementNotes !== undefined) vm.addtionalVendorManagementNotes = vendorPayload.addtionalVendorManagementNotes ?? null;
    if (vendorPayload.acknowledgeMaintenanceResponsibility !== undefined) vm.acknowledgeMaintenanceResponsibility = vendorPayload.acknowledgeMaintenanceResponsibility ?? null;
    if (vendorPayload.authorizeLuxuryLodgingAction !== undefined) vm.authorizeLuxuryLodgingAction = vendorPayload.authorizeLuxuryLodgingAction ?? null;
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
        if (v.role !== undefined) row.role = v.role ?? null;
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
      if (b.bathroomFeatures !== undefined) row.bathroomFeatures = b.bathroomFeatures ?? null;
      if (b.privacyType !== undefined) row.privacyType = b.privacyType ?? null;
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
        clientProperty.streetAddress = property.streetAddress ?? null;
        clientProperty.unitNumber = property.unitNumber ?? null;
        clientProperty.city = property.city ?? null;
        clientProperty.state = property.state ?? null;
        clientProperty.country = property.country ?? null;
        clientProperty.zipCode = property.zipCode ?? null;
        clientProperty.latitude = property.latitude ?? null;
        clientProperty.longitude = property.longitude ?? null;
        clientProperty.updatedAt = new Date();
        clientProperty.updatedBy = userId;
        await this.propertyRepo.save(clientProperty);
      } else {
        // Create new property
        clientProperty = this.propertyRepo.create({
          address: property.address,
          streetAddress: property.streetAddress ?? null,
          unitNumber: property.unitNumber ?? null,
          city: property.city ?? null,
          state: property.state ?? null,
          country: property.country ?? null,
          zipCode: property.zipCode ?? null,
          latitude: property.latitude ?? null,
          longitude: property.longitude ?? null,
          client: { id: clientId } as any,
          createdBy: userId,
          status: PropertyStatus.ONBOARDING,
        });
        clientProperty = await this.propertyRepo.save(clientProperty);
      }

      const listingPayload = property.onboarding?.listing;
      const photographyPayload = property.onboarding?.photography;
      if (!listingPayload && !photographyPayload) {
        throw CustomErrorHandler.validationError("listing or photography payload is required");
      }

      let onboarding = clientProperty.onboarding;
      if (!onboarding) {
        onboarding = this.propertyOnboardingRepo.create({ clientProperty, createdBy: userId });
      }

      if (listingPayload) {
        // Map client-facing onboarding fields
        if (listingPayload.targetLiveDate !== undefined) onboarding.targetLiveDate = listingPayload.targetLiveDate ?? null;
        if (listingPayload.targetStartDate !== undefined) onboarding.targetStartDate = listingPayload.targetStartDate ?? null;
        if (listingPayload.upcomingReservations !== undefined) onboarding.upcomingReservations = listingPayload.upcomingReservations ?? null;
        if (listingPayload.onboardingCallSchedule !== undefined) onboarding.onboardingCallSchedule = listingPayload.onboardingCallSchedule ?? null;

        // Store client-facing specific fields in targetDateNotes as JSON
        const clientFormData = {
          acknowledgePropertyReadyByStartDate: listingPayload.acknowledgePropertyReadyByStartDate ?? null,
          agreesUnpublishExternalListings: listingPayload.agreesUnpublishExternalListings ?? null,
          externalListingNotes: listingPayload.externalListingNotes ?? null,
          acknowledgesResponsibilityToInform: listingPayload.acknowledgesResponsibilityToInform ?? null,
        };
        onboarding.targetDateNotes = JSON.stringify(clientFormData);
      }

      if (photographyPayload) {
        if (photographyPayload.photographyNotes !== undefined) onboarding.photographyNotes = photographyPayload.photographyNotes ?? null;
      }

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
          clientProperty.streetAddress = property.streetAddress ?? null;
          clientProperty.city = property.city ?? null;
          clientProperty.state = property.state ?? null;
          clientProperty.country = property.country ?? null;
          clientProperty.zipCode = property.zipCode ?? null;
          clientProperty.latitude = property.latitude ?? null;
          clientProperty.longitude = property.longitude ?? null;
          clientProperty.updatedAt = new Date();
          clientProperty.updatedBy = userId;
          await this.propertyRepo.save(clientProperty);
        }
      } else {
        // Create new property
        clientProperty = this.propertyRepo.create({
          address: property.address,
          streetAddress: property.streetAddress ?? null,
          unitNumber: property.unitNumber ?? null,
          city: property.city ?? null,
          state: property.state ?? null,
          country: property.country ?? null,
          zipCode: property.zipCode ?? null,
          latitude: property.latitude ?? null,
          longitude: property.longitude ?? null,
          client: { id: clientId } as any,
          createdBy: userId,
          status: PropertyStatus.ONBOARDING,
        });
        clientProperty = await this.propertyRepo.save(clientProperty);
      }

      const listingPayload = property.onboarding?.listing;
      const photographyPayload = property.onboarding?.photography;
      if (listingPayload || photographyPayload) {
        let onboarding = clientProperty.onboarding;
        if (!onboarding) {
          onboarding = this.propertyOnboardingRepo.create({ clientProperty, createdBy: userId });
        }

        if (listingPayload) {
          // Map client-facing onboarding fields
          if (listingPayload.targetLiveDate !== undefined) onboarding.targetLiveDate = listingPayload.targetLiveDate ?? null;
          if (listingPayload.targetStartDate !== undefined) onboarding.targetStartDate = listingPayload.targetStartDate ?? null;
          if (listingPayload.upcomingReservations !== undefined) onboarding.upcomingReservations = listingPayload.upcomingReservations ?? null;
          if (listingPayload.onboardingCallSchedule !== undefined) onboarding.onboardingCallSchedule = listingPayload.onboardingCallSchedule ?? null;
          if (listingPayload.targetDateNotes !== undefined) onboarding.targetDateNotes = listingPayload.targetDateNotes ?? null;
          if (listingPayload.acknowledgePropertyReadyByStartDate !== undefined) onboarding.acknowledgePropertyReadyByStartDate = listingPayload.acknowledgePropertyReadyByStartDate ?? false;
          if (listingPayload.agreesUnpublishExternalListings !== undefined) onboarding.agreesUnpublishExternalListings = listingPayload.agreesUnpublishExternalListings ?? false;
          if (listingPayload.acknowledgesResponsibilityToInform !== undefined) onboarding.acknowledgesResponsibilityToInform = listingPayload.acknowledgesResponsibilityToInform ?? false;

          // Store client-facing specific fields in targetDateNotes as JSON
          const clientFormData = {
            acknowledgePropertyReadyByStartDate: listingPayload.acknowledgePropertyReadyByStartDate ?? null,
            agreesUnpublishExternalListings: listingPayload.agreesUnpublishExternalListings ?? null,
            externalListingNotes: listingPayload.externalListingNotes ?? null,
            acknowledgesResponsibilityToInform: listingPayload.acknowledgesResponsibilityToInform ?? null,
          };
          onboarding.targetDateNotes = JSON.stringify(clientFormData);
        }

        if (photographyPayload) {
          if (photographyPayload.photographyNotes !== undefined) onboarding.photographyNotes = photographyPayload.photographyNotes ?? null;
        }

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

      // Handle address fields
      let addressFieldsUpdated = false;
      if ((property as any).address !== undefined) {
        clientProperty.address = property.address;
        addressFieldsUpdated = true;
      }
      if ((property as any).streetAddress !== undefined) {
        clientProperty.streetAddress = property.streetAddress ?? null;
        addressFieldsUpdated = true;
      }
      if ((property as any).unitNumber !== undefined) {
        clientProperty.unitNumber = property.unitNumber ?? null;
        addressFieldsUpdated = true;
      }
      if ((property as any).city !== undefined) {
        clientProperty.city = property.city ?? null;
        addressFieldsUpdated = true;
      }
      if ((property as any).state !== undefined) {
        clientProperty.state = property.state ?? null;
        addressFieldsUpdated = true;
      }
      if ((property as any).country !== undefined) {
        clientProperty.country = property.country ?? null;
        addressFieldsUpdated = true;
      }
      if ((property as any).zipCode !== undefined) {
        clientProperty.zipCode = property.zipCode ?? null;
        addressFieldsUpdated = true;
      }
      if ((property as any).latitude !== undefined) {
        clientProperty.latitude = property.latitude ?? null;
        addressFieldsUpdated = true;
      }
      if ((property as any).longitude !== undefined) {
        clientProperty.longitude = property.longitude ?? null;
        addressFieldsUpdated = true;
      }
      if (addressFieldsUpdated) {
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

  async submitAllClientForms(body: any, userId: string) {
    const { clientData, onboardingData, listingData } = body;

    // Step 1: Update Client (Property Owner Information)
    if (clientData && typeof clientData === 'object' && !Array.isArray(clientData)) {
      const { id, ...clientUpdateData } = clientData;
      const secondaryContacts = clientData.secondaryContacts;
      await this.updateClient(
        { id, ...clientUpdateData },
        userId,
        secondaryContacts
      );
    }

    // Step 2: Update Onboarding Details (Onboarding Information)
    if (onboardingData && typeof onboardingData === 'object' && !Array.isArray(onboardingData)) {
      await this.updateOnboardingDetailsClientForm(onboardingData, userId);
    }

    // Step 3: Update Listing Details (Property and Management Information)
    if (listingData && typeof listingData === 'object' && !Array.isArray(listingData)) {
      await this.updateListingDetailsClientForm(listingData, userId);
    }

    return { message: "All client forms submitted successfully" };
  }

  //publish listingIntake to hostaway
  async publishPropertyToHostaway(propertyId: string, userId: string) {
    const listingIntake = await this.propertyRepo.findOne({
      where: { id: propertyId },
      relations: ["onboarding", "serviceInfo", "propertyInfo", "propertyInfo.propertyBedTypes", "propertyInfo.propertyUpsells", "client"]
    });


    if (!listingIntake) {
      throw CustomErrorHandler.notFound(`Property with ID ${propertyId} not found.`);
    }

    // Here you would implement the logic to publish the property to Hostaway
    // This is a placeholder for the actual implementation
    logger.info("Publishing property to Hostaway");

    // Simulate successful publishing
    let status = this.getListingIntakeStatus(listingIntake.propertyInfo);
    if (status === "draft") {
      throw CustomErrorHandler.forbidden("Missing required fields. Cannot be published to Hostaway.");
    }
    if (listingIntake.listingId) {
      throw CustomErrorHandler.forbidden("Property is already published to Hostaway.");
    }

    //prepare hostaway payload
    const hostawayPayload = {
      name: listingIntake.propertyInfo.externalListingName,
      externalListingName: listingIntake.propertyInfo.externalListingName,
      internalListingName: listingIntake.propertyInfo.internalListingName,
      price: listingIntake.propertyInfo.price || 3000,
      priceForExtraPerson: listingIntake.propertyInfo.priceForExtraPerson || 0,
      propertyTypeId: listingIntake.propertyInfo.propertyTypeId,
      roomType: listingIntake.propertyInfo.roomType,
      bedroomsNumber: listingIntake.propertyInfo.bedroomsNumber,
      bathroomsNumber: listingIntake.propertyInfo.bathroomsNumber,
      bathroomType: listingIntake.propertyInfo.bathroomType,
      guestBathroomsNumber: listingIntake.propertyInfo.guestBathroomsNumber,
      address: listingIntake.address,
      timeZoneName: listingIntake.client.timezone,
      currencyCode: listingIntake.propertyInfo.currencyCode || "USD",
      personCapacity: listingIntake.propertyInfo.personCapacity,
      cleaningFee: listingIntake.propertyInfo?.vendorManagementInfo?.cleaningFee || null,
      airbnbPetFeeAmount: listingIntake.propertyInfo.petFee,
      checkOutTime: listingIntake.propertyInfo.checkOutTime,
      checkInTimeStart: listingIntake.propertyInfo.checkInTimeStart,
      checkInTimeEnd: listingIntake.propertyInfo.checkInTimeEnd,
      squareMeters: listingIntake.propertyInfo.squareMeters,
      language: "en",
      instantBookable: listingIntake.propertyInfo?.canAnyoneBookAnytime?.includes("Yes") || false,
      instantBookableLeadTime: listingIntake.propertyInfo.leadTimeDays || null,
      wifiUsername: listingIntake.propertyInfo.wifiUsername,
      wifiPassword: listingIntake.propertyInfo.wifiPassword,
      minNights: listingIntake.propertyInfo.minNights,
      maxNights: listingIntake.propertyInfo.maxNights,
      contactName: "Luxury Lodging",
      contactPhone1: "(813) 531-8988",
      contactLanguage: "English",
      guestsIncluded: listingIntake.propertyInfo.guestsIncluded || 1,

      amenities: listingIntake.propertyInfo?.amenities?.map((amenity: any) => {
        return { amenityId: Number(amenity) };
      }),

      listingBedTypes: listingIntake.propertyInfo?.propertyBedTypes?.filter((bedType: any) => bedType.bedTypeId && bedType.quantity && bedType.bedroomNumber)
        .map(bedType => ({
          bedTypeId: bedType.bedTypeId,
          quantity: bedType.quantity,
          bedroomNumber: bedType.bedroomNumber,
        })),

      propertyLicenseNumber: listingIntake.propertyInfo.propertyLicenseNumber,
    };

    logger.info(JSON.stringify(hostawayPayload));

    //simulate taking time of 10s
    // await new Promise(resolve => setTimeout(resolve, 10000));

    const response = await this.hostawayClient.createListing(hostawayPayload);
    if (!response) {
      throw new CustomErrorHandler(500, "Failed to publish listing intake to Hostaway");
    }
    // Update the listingIntake status to published
    listingIntake.status = PropertyStatus.ACTIVE;
    listingIntake.listingId = response.id; // Assuming response contains the Hostaway listing ID
    listingIntake.updatedBy = userId;
    await this.propertyRepo.save(listingIntake);

    return { message: "Property published to Hostaway successfully", listingIntake };
  }

  private getListingIntakeStatus(listingIntake: any) {
    const requiredFields = [
      "externalListingName",
      // "address",
      // "price", //default 3000
      // "guestsIncluded", //default 1
      // "priceForExtraPerson", //default 0
      // "currencyCode" //default USD
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
        if (financials.minPriceWeekday !== undefined) propertyInfo.minPriceWeekday = financials.minPriceWeekday ?? null;
        if (financials.minPriceWeekend !== undefined) propertyInfo.minPriceWeekend = financials.minPriceWeekend ?? null;
        if (financials.minNights !== undefined) propertyInfo.minNights = financials.minNights ?? null;
        if (financials.minNightsWeekday !== undefined) propertyInfo.minNightsWeekday = financials.minNightsWeekday ?? null;
        if (financials.minNightsWeekend !== undefined) propertyInfo.minNightsWeekend = financials.minNightsWeekend ?? null;
        if (financials.maxNights !== undefined) propertyInfo.maxNights = financials.maxNights ?? null;
        if (financials.propertyLicenseNumber !== undefined) propertyInfo.propertyLicenseNumber = financials.propertyLicenseNumber ?? null;
        if (financials.tax !== undefined) propertyInfo.tax = financials.tax ?? null;
        if (financials.financialNotes !== undefined) propertyInfo.financialNotes = financials.financialNotes ?? null;
        if (financials.statementSchedule !== undefined) propertyInfo.statementSchedule = financials.statementSchedule ?? null;
        if (financials.statementType !== undefined) propertyInfo.statementType = financials.statementType ?? null;
        if (financials.payoutMethod !== undefined) propertyInfo.payoutMethod = financials.payoutMethod ?? null;
        if (financials.claimFee !== undefined) propertyInfo.claimFee = financials.claimFee ?? null;
        if (financials.claimFeeNotes !== undefined) propertyInfo.claimFeeNotes = financials.claimFeeNotes ?? null;
        if (financials.techFee !== undefined) propertyInfo.techFee = financials.techFee ?? null;
        if (financials.techFeeNotes !== undefined) propertyInfo.techFeeNotes = financials.techFeeNotes ?? null;
        if (financials.minimumStay !== undefined) propertyInfo.minimumStay = financials.minimumStay ?? null;
        if (financials.maximumStay !== undefined) propertyInfo.maximumStay = financials.maximumStay ?? null;
        if (financials.pricingStrategyPreference !== undefined) propertyInfo.pricingStrategyPreference = financials.pricingStrategyPreference ?? null;
        if (financials.minimumNightsRequiredByLaw !== undefined) propertyInfo.minimumNightsRequiredByLaw = financials.minimumNightsRequiredByLaw ?? null;
        if (financials.onboardingFee !== undefined) propertyInfo.onboardingFee = financials.onboardingFee ?? null;
        if (financials.onboardingFeeAmountAndConditions !== undefined) propertyInfo.onboardingFeeAmountAndConditions = financials.onboardingFeeAmountAndConditions ?? null;
        if (financials.offboardingFee !== undefined) propertyInfo.offboardingFee = financials.offboardingFee ?? null;
        if (financials.offboardingFeeAmountAndConditions !== undefined) propertyInfo.offboardingFeeAmountAndConditions = financials.offboardingFeeAmountAndConditions ?? null;
        if (financials.payoutSchdule !== undefined) propertyInfo.payoutSchdule = financials.payoutSchdule ?? null;
        if (financials.taxesAddedum !== undefined) propertyInfo.taxesAddedum = financials.taxesAddedum ?? null;


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
        if (listingPayload.emergencyBackUpCode !== undefined) propertyInfo.emergencyBackUpCode = listingPayload.emergencyBackUpCode ?? null;
        if (listingPayload.standardDoorCode !== undefined) propertyInfo.standardDoorCode = listingPayload.standardDoorCode ?? null;

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
        if (listingPayload.petFeeType !== undefined) propertyInfo.petFeeType = listingPayload.petFeeType ?? null;
        if (listingPayload.numberOfPetsAllowed !== undefined) propertyInfo.numberOfPetsAllowed = listingPayload.numberOfPetsAllowed ?? null;
        if (listingPayload.petRestrictionsNotes !== undefined) propertyInfo.petRestrictionsNotes = listingPayload.petRestrictionsNotes ?? null;
        if (listingPayload.allowChildreAndInfants !== undefined) propertyInfo.allowChildreAndInfants = listingPayload.allowChildreAndInfants ?? null;
        if (listingPayload.childrenInfantsRestrictionReason !== undefined) propertyInfo.childrenInfantsRestrictionReason = listingPayload.childrenInfantsRestrictionReason ?? null;
        if (listingPayload.allowLuggageDropoffBeforeCheckIn !== undefined) propertyInfo.allowLuggageDropoffBeforeCheckIn = listingPayload.allowLuggageDropoffBeforeCheckIn ?? null;
        if (listingPayload.otherHouseRules !== undefined) propertyInfo.otherHouseRules = listingPayload.otherHouseRules ?? null;

        // WiFi
        if (listingPayload.wifiAvailable !== undefined) propertyInfo.wifiAvailable = listingPayload.wifiAvailable ?? null;
        if (listingPayload.wifiUsername !== undefined) propertyInfo.wifiUsername = listingPayload.wifiUsername ?? null;
        if (listingPayload.wifiPassword !== undefined) propertyInfo.wifiPassword = listingPayload.wifiPassword ?? null;
        if (listingPayload.wifiSpeed !== undefined) propertyInfo.wifiSpeed = listingPayload.wifiSpeed ?? null;
        if (listingPayload.locationOfModem !== undefined) propertyInfo.locationOfModem = listingPayload.locationOfModem ?? null;
        if (listingPayload.ethernetCable !== undefined) propertyInfo.ethernetCable = listingPayload.ethernetCable ?? null;
        if (listingPayload.pocketWifi !== undefined) propertyInfo.pocketWifi = listingPayload.pocketWifi ?? null;
        if (listingPayload.paidWifi !== undefined) propertyInfo.paidWifi = listingPayload.paidWifi ?? null;

        // Vendor Management
        if (listingPayload.vendorManagement) {
          await this.handleVendorManagementInfo(propertyInfo, listingPayload.vendorManagement);
        }

        // Standard Booking Settings
        if (listingPayload.instantBooking !== undefined) propertyInfo.instantBooking = listingPayload.instantBooking ?? null;
        if (listingPayload.instantBookingNotes !== undefined) propertyInfo.instantBookingNotes = listingPayload.instantBookingNotes ?? null;
        if (listingPayload.minimumAdvanceNotice !== undefined) propertyInfo.minimumAdvanceNotice = listingPayload.minimumAdvanceNotice ?? null;
        if (listingPayload.minimumAdvanceNoticeNotes !== undefined) propertyInfo.minimumAdvanceNoticeNotes = listingPayload.minimumAdvanceNoticeNotes ?? null;
        if (listingPayload.preparationDays !== undefined) propertyInfo.preparationDays = listingPayload.preparationDays ?? null;
        if (listingPayload.preparationDaysNotes !== undefined) propertyInfo.preparationDaysNotes = listingPayload.preparationDaysNotes ?? null;
        if (listingPayload.bookingWindow !== undefined) propertyInfo.bookingWindow = listingPayload.bookingWindow ?? null;
        if (listingPayload.bookingWindowNotes !== undefined) propertyInfo.bookingWindowNotes = listingPayload.bookingWindowNotes ?? null;
        if (listingPayload.minimumStay !== undefined) propertyInfo.minimumStay = listingPayload.minimumStay ?? null;
        if (listingPayload.minimumStayNotes !== undefined) propertyInfo.minimumStayNotes = listingPayload.minimumStayNotes ?? null;
        if (listingPayload.maximumStay !== undefined) propertyInfo.maximumStay = listingPayload.maximumStay ?? null;
        if (listingPayload.maximumStayNotes !== undefined) propertyInfo.maximumStayNotes = listingPayload.maximumStayNotes ?? null;

        // Management Notes
        if (listingPayload.managementNotes !== undefined) propertyInfo.managementNotes = listingPayload.managementNotes ?? null;
        if (listingPayload.acknowledgeNoGuestContact !== undefined) propertyInfo.acknowledgeNoGuestContact = listingPayload.acknowledgeNoGuestContact ?? null;
        if (listingPayload.acknowledgeNoPropertyAccess !== undefined) propertyInfo.acknowledgeNoPropertyAccess = listingPayload.acknowledgeNoPropertyAccess ?? null;
        if (listingPayload.acknowledgeNoDirectTransactions !== undefined) propertyInfo.acknowledgeNoDirectTransactions = listingPayload.acknowledgeNoDirectTransactions ?? null;

        propertyInfo.updatedBy = userId;
        await this.propertyInfoRepo.save(propertyInfo);
      }

      const refreshed = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["propertyInfo"] });
      updated.push({ clientProperty: refreshed!, propertyInfo: refreshed!.propertyInfo ?? null });
    }

    return { message: "Internal management updated", updated };
  }

  async processCSVData(filePath: string): Promise<CsvRow[]> {

    const allowedTimezones = timezoneAmerica.map(tz => tz.value);

    return new Promise((resolve, reject) => {
      const results: CsvRow[] = [];

      fs.createReadStream(filePath)
        .pipe(csv({
          mapHeaders: ({ header }) => header.replace(/^\uFEFF/, "").trim()
        }))
        .on("headers", (headers: string[]) => {
          // ✅ validate headers once, not per row
          const requiredHeaders = [
            "PC_First_Name",
            "PC_Last_Name",
            "PC_Email",
          ];
          const missing = requiredHeaders.filter(h => !headers.includes(h));
          if (missing.length > 0) {
            fs.unlinkSync(filePath);
            reject(new CustomErrorHandler(400, `Missing required headers in the CSV file: ${missing.join(", ")}`));
          }
        })
        .on("data", (data: CsvRow) => {
          try {
            results.push(data);
          } catch (err) {
            // skip rows with invalid date format
            logger.warn(`Skipping row with err: ${err}`);
          }
        })
        .on("end", () => {
          resolve(results);
        })
        .on("error", (err) => {
          fs.unlinkSync(filePath);
          reject(err);
        });
    });
  }


  async processCSVFileForClientCreation(filePath: string, userId: string) {
    const filteredRows = await this.processCSVData(filePath);
    const failedToProcessData: (CsvRow & { reason?: string; })[] = [];
    const successfullyProcessedData: CsvRow[] = [];

    if (filteredRows.length === 0) {
      fs.unlinkSync(filePath); // Delete the file after processing
      return { successfullyProcessedData, failedToProcessData };
    }

    for (const row of filteredRows) {
      const primaryContactFirstName = row.PC_First_Name?.trim();
      const primaryContactLastName = row.PC_Last_Name?.trim();
      const primaryContactEmail = row.PC_Email?.trim();
      const primaryContactPreferredName = row.PC_Preferred_Name?.trim();
      const primaryContactPhone = row.PC_Phone?.trim();
      const primaryContactTimezone = row.PC_Timezone?.trim();
      const primaryContactCompany = row.PC_Company?.trim();

      const clientFolder = row.Client_Folder?.trim();

      const secondaryContactFirstName = row.SC_First_Name?.trim();
      const secondaryContactLastName = row.SC_Last_Name?.trim();
      const secondaryContactEmail = row.SC_Email?.trim();
      const secondaryContactPreferredName = row.SC_Preferred_Name?.trim();
      const secondaryContactPhone = row.SC_Phone?.trim();
      const secondaryContactTimezone = row.SC_Timezone?.trim();
      const secondaryContactCompany = row.SC_Company?.trim();

      const pointOfContactFirstName = row.POC_First_Name?.trim();
      const pointOfContactLastName = row.POC_Last_Name?.trim();
      const pointOfContactEmail = row.POC_Email?.trim();
      const pointOfContactPreferredName = row.POC_Preferred_Name?.trim();
      const pointOfContactPhone = row.POC_Phone?.trim();
      const pointOfContactTimezone = row.POC_Timezone?.trim();
      const pointOfContactCompany = row.POC_Company?.trim();

      const propertyId = row.Property_Id?.trim();
      const propertyIds = propertyId ? propertyId.split(",").map(id => id.trim()) : [];

      const serviceTypeStr = row.Service_Type?.trim();
      const rawServiceTypes = serviceTypeStr ? serviceTypeStr.split(",").map(st => st.trim()) : [];

      const pmFeeStr = row.PM_Fee?.trim();
      const rawPmFees = pmFeeStr ? pmFeeStr.split(",").map(fee => fee.trim()) : [];

      // Validate that Service_Type and PM_Fee arrays match Property_Id array length
      if (propertyIds.length > 0) {
        if (rawServiceTypes.length > 0 && rawServiceTypes.length !== propertyIds.length) {
          failedToProcessData.push({ ...row, reason: "Service_Type count must match Property_Id count" });
          logger.warn(`Skipping row due to mismatched Service_Type count: ${JSON.stringify(row)}`);
          continue;
        }
        if (rawPmFees.length > 0 && rawPmFees.length !== propertyIds.length) {
          failedToProcessData.push({ ...row, reason: "PM_Fee count must match Property_Id count" });
          logger.warn(`Skipping row due to mismatched PM_Fee count: ${JSON.stringify(row)}`);
          continue;
        }
      }

      // Validate and normalize Service_Type values
      const allowedServiceTypes = ['LAUNCH', 'FULL', 'PRO'];
      const serviceTypes: (string | null)[] = [];
      let hasInvalidServiceType = false;
      for (const st of rawServiceTypes) {
        if (st) {
          const upperSt = st.toUpperCase();
          if (!allowedServiceTypes.includes(upperSt)) {
            failedToProcessData.push({ ...row, reason: `Invalid Service_Type "${st}". Must be one of: Launch, Full, Pro` });
            logger.warn(`Skipping row due to invalid Service_Type: ${JSON.stringify(row)}`);
            hasInvalidServiceType = true;
            break;
          }
          serviceTypes.push(upperSt);
        } else {
          serviceTypes.push(null);
        }
      }
      if (hasInvalidServiceType) continue;

      // Validate and normalize PM_Fee values
      const pmFees: (string | null)[] = [];
      let hasInvalidPmFee = false;
      for (const fee of rawPmFees) {
        if (fee) {
          // Remove % symbol if present
          const cleanedFee = fee.replace('%', '').trim();

          // Validate it's a valid number
          if (cleanedFee && isNaN(Number(cleanedFee))) {
            failedToProcessData.push({ ...row, reason: `Invalid PM_Fee "${fee}". Must be a valid number` });
            logger.warn(`Skipping row due to invalid PM_Fee: ${JSON.stringify(row)}`);
            hasInvalidPmFee = true;
            break;
          }

          pmFees.push(cleanedFee || null);
        } else {
          pmFees.push(null);
        }
      }
      if (hasInvalidPmFee) continue;

      if (!primaryContactFirstName || !primaryContactLastName || !primaryContactEmail) {
        failedToProcessData.push({ ...row, reason: "Missing primary contact information like firstName, lastName and email" });
        logger.warn(`Skipping row due to missing primary contact info: ${JSON.stringify(row)}`);
        continue;
      }
      const allowedTimezones = timezoneAmerica.map(tz => tz.value);
      if (primaryContactTimezone && !allowedTimezones.includes(primaryContactTimezone || "")) {
        failedToProcessData.push({ ...row, reason: "Invalid primary contact timezone" });
        logger.warn(`Skipping row due to invalid primary contact timezone: ${JSON.stringify(row)}`);
        continue;
      }

      if (secondaryContactTimezone && !allowedTimezones.includes(secondaryContactTimezone)) {
        failedToProcessData.push({ ...row, reason: "Invalid secondary contact timezone" });
        logger.warn(`Skipping row due to invalid secondary contact timezone: ${JSON.stringify(row)}`);
        continue;
      }

      if (pointOfContactTimezone && !allowedTimezones.includes(pointOfContactTimezone || "")) {
        failedToProcessData.push({ ...row, reason: "Invalid point of contact timezone" });
        logger.warn(`Skipping row due to invalid point of contact timezone: ${JSON.stringify(row)}`);
        continue;
      }

      //check email
      if (!isEmail(primaryContactEmail)) {
        failedToProcessData.push({ ...row, reason: "Invalid primary contact email format" });
        logger.warn(`Skipping row due to invalid primary contact email: ${JSON.stringify(row)}`);
        continue;
      }

      if (secondaryContactEmail && !isEmail(secondaryContactEmail)) {
        failedToProcessData.push({ ...row, reason: "Invalid secondary contact email format" });
        logger.warn(`Skipping row due to invalid secondary contact email: ${JSON.stringify(row)}`);
        continue;
      }

      if (pointOfContactEmail && !isEmail(pointOfContactEmail)) {
        failedToProcessData.push({ ...row, reason: "Invalid point of contact email format" });
        logger.warn(`Skipping row due to invalid point of contact email: ${JSON.stringify(row)}`);
        continue;
      }


      //check if client already exists
      const existingClient = await this.clientRepo.findOne({
        where: {
          email: primaryContactEmail
        },
        relations: ['secondaryContacts', 'properties', 'properties.propertyInfo', 'properties.serviceInfo', 'properties.propertyInfo.vendorManagementInfo']
      });

      //create or update client - wrap everything in a single transaction for atomicity
      try {
        await appDatabase.transaction(async (transactionalEntityManager) => {
          let client: ClientEntity;

          if (existingClient) {
            // Update existing client
            logger.info(`🔄 Updating existing client: ${existingClient.id} (${primaryContactEmail})`);
            existingClient.firstName = primaryContactFirstName;
            existingClient.lastName = primaryContactLastName;
            existingClient.preferredName = primaryContactPreferredName || null;
            existingClient.phone = primaryContactPhone || null;
            existingClient.timezone = timezoneAmerica.find(tz => tz.value == primaryContactTimezone).id || null;
            existingClient.companyName = primaryContactCompany || null;
            existingClient.clientFolder = clientFolder || null;
            existingClient.updatedBy = userId;
            client = await transactionalEntityManager.save(existingClient);
          } else {
            // Create new client
            logger.info(`✨ Creating new client: ${primaryContactEmail}`);
            const newClient = transactionalEntityManager.create(ClientEntity, {
              firstName: primaryContactFirstName,
              lastName: primaryContactLastName,
              preferredName: primaryContactPreferredName || null,
              email: primaryContactEmail,
              phone: primaryContactPhone || null,
              timezone: timezoneAmerica.find(tz => tz.value == primaryContactTimezone).id || null,
              companyName: primaryContactCompany || null,
              clientFolder: clientFolder || null,
              source: "clientsPage",
              createdBy: userId,
              status: "active"
            });
            client = await transactionalEntityManager.save(newClient);
          }

          //handle secondary contact - update if exists, create if new
          const isSecondaryContactProvided = secondaryContactFirstName && secondaryContactLastName && secondaryContactEmail;
          if (isSecondaryContactProvided) {
            const existingSecondaryContact = existingClient?.secondaryContacts?.find(c => c.type === 'secondaryContact');

            if (existingSecondaryContact) {
              // Update existing secondary contact
              existingSecondaryContact.firstName = secondaryContactFirstName;
              existingSecondaryContact.lastName = secondaryContactLastName;
              existingSecondaryContact.preferredName = secondaryContactPreferredName || null;
              existingSecondaryContact.email = secondaryContactEmail;
              existingSecondaryContact.phone = secondaryContactPhone || null;
              existingSecondaryContact.timezone = timezoneAmerica.find(tz => tz.value == secondaryContactTimezone).id || null;
              existingSecondaryContact.companyName = secondaryContactCompany || null;
              existingSecondaryContact.updatedBy = userId;
              await transactionalEntityManager.save(existingSecondaryContact);
            } else {
              // Create new secondary contact
              const secondaryContact = transactionalEntityManager.create(ClientSecondaryContact, {
                firstName: secondaryContactFirstName,
                lastName: secondaryContactLastName,
                preferredName: secondaryContactPreferredName || null,
                email: secondaryContactEmail,
                phone: secondaryContactPhone || null,
                timezone: timezoneAmerica.find(tz => tz.value == secondaryContactTimezone).id || null,
                companyName: secondaryContactCompany || null,
                type: 'secondaryContact',
                client: client,
                createdBy: userId,
              });
              await transactionalEntityManager.save(secondaryContact);
            }
          }

          //handle point of contact - update if exists, create if new
          const isPointOfContactProvided = pointOfContactFirstName && pointOfContactLastName && pointOfContactEmail;
          if (isPointOfContactProvided) {
            const existingPointOfContact = existingClient?.secondaryContacts?.find(c => c.type === 'pointOfContact');

            if (existingPointOfContact) {
              // Update existing point of contact
              existingPointOfContact.firstName = pointOfContactFirstName;
              existingPointOfContact.lastName = pointOfContactLastName;
              existingPointOfContact.preferredName = pointOfContactPreferredName || null;
              existingPointOfContact.email = pointOfContactEmail;
              existingPointOfContact.phone = pointOfContactPhone || null;
              existingPointOfContact.timezone = timezoneAmerica.find(tz => tz.value == pointOfContactTimezone).id || null;
              existingPointOfContact.companyName = pointOfContactCompany || null;
              existingPointOfContact.updatedBy = userId;
              await transactionalEntityManager.save(existingPointOfContact);
            } else {
              // Create new point of contact
              const pointOfContact = transactionalEntityManager.create(ClientSecondaryContact, {
                firstName: pointOfContactFirstName,
                lastName: pointOfContactLastName,
                preferredName: pointOfContactPreferredName || null,
                email: pointOfContactEmail,
                phone: pointOfContactPhone || null,
                timezone: timezoneAmerica.find(tz => tz.value == pointOfContactTimezone).id || null,
                companyName: pointOfContactCompany || null,
                type: 'pointOfContact',
                client: client,
                createdBy: userId,
              });
              await transactionalEntityManager.save(pointOfContact);
            }
          }

          // Process properties within the same transaction
          if (propertyIds.length > 0) {
            const listingService = new ListingService();
            for (let i = 0; i < propertyIds.length; i++) {
              const listingId = propertyIds[i];
              const serviceType = serviceTypes[i] || null;
              const managementFee = pmFees[i] || null;

              const listingInfo = await listingService.getListingInfo(Number(listingId), userId);

              if (!listingInfo) {
                logger.error(`❌ Listing not found for listingId: ${listingId}`);
                throw new Error(`Listing not found for listingId: ${listingId}`);
              }

              logger.info(`🔄 Processing listingId: ${listingId} for client: ${client.id}`);

              // Check if property already exists for this client
              const existingProperty = existingClient?.properties?.find(p => p.listingId === listingId);
              let savedProperty: ClientPropertyEntity;

              if (existingProperty) {
                // Update existing property
                logger.info(`🔄 Updating existing property: ${existingProperty.id} for listingId: ${listingId}`);
                existingProperty.address = listingInfo.address;
                existingProperty.status = PropertyStatus.ACTIVE;
                existingProperty.updatedBy = userId;
                savedProperty = await transactionalEntityManager.save(existingProperty);

                // Update propertyInfo if it exists
                if (existingProperty.propertyInfo) {
                  const propertyInfo = existingProperty.propertyInfo;
                  propertyInfo.externalListingName = listingInfo.externalListingName;
                  propertyInfo.internalListingName = listingInfo.internalListingName;
                  propertyInfo.price = listingInfo.price;
                  propertyInfo.priceForExtraPerson = listingInfo.priceForExtraPerson;
                  propertyInfo.propertyTypeId = listingInfo.propertyTypeId != null ? String(listingInfo.propertyTypeId) : null;
                  propertyInfo.roomType = listingInfo.roomType;
                  propertyInfo.bedroomsNumber = listingInfo.bedroomsNumber;
                  propertyInfo.bathroomsNumber = listingInfo.bathroomsNumber;
                  propertyInfo.bathroomType = listingInfo.bathroomType;
                  propertyInfo.guestBathroomsNumber = listingInfo.guestBathroomsNumber;
                  propertyInfo.address = listingInfo.address;
                  propertyInfo.currencyCode = listingInfo.currencyCode;
                  propertyInfo.personCapacity = listingInfo.personCapacity;
                  propertyInfo.petFee = listingInfo.airbnbPetFeeAmount;
                  propertyInfo.checkOutTime = listingInfo.checkOutTime;
                  propertyInfo.checkInTimeStart = listingInfo.checkInTimeStart;
                  propertyInfo.checkInTimeEnd = listingInfo.checkInTimeEnd;
                  propertyInfo.squareMeters = listingInfo.squareMeters;
                  propertyInfo.wifiUsername = listingInfo.wifiUsername;
                  propertyInfo.wifiPassword = listingInfo.wifiPassword;
                  propertyInfo.minNights = listingInfo.minNights;
                  propertyInfo.maxNights = listingInfo.maxNights;
                  propertyInfo.propertyLicenseNumber = listingInfo.propertyLicenseNumber;
                  propertyInfo.updatedBy = userId;

                  // Update vendorManagementInfo
                  if (propertyInfo.vendorManagementInfo) {
                    propertyInfo.vendorManagementInfo.cleaningFee = listingInfo.cleaningFee;
                    await transactionalEntityManager.save(propertyInfo.vendorManagementInfo);
                  }

                  await transactionalEntityManager.save(propertyInfo);
                } else {
                  // Create propertyInfo if it doesn't exist
                  const propertyInfo = transactionalEntityManager.create(PropertyInfo, {
                    externalListingName: listingInfo.externalListingName,
                    internalListingName: listingInfo.internalListingName,
                    price: listingInfo.price,
                    priceForExtraPerson: listingInfo.priceForExtraPerson,
                    propertyTypeId: listingInfo.propertyTypeId != null ? String(listingInfo.propertyTypeId) : null,
                    roomType: listingInfo.roomType,
                    bedroomsNumber: listingInfo.bedroomsNumber,
                    bathroomsNumber: listingInfo.bathroomsNumber,
                    bathroomType: listingInfo.bathroomType,
                    guestBathroomsNumber: listingInfo.guestBathroomsNumber,
                    address: listingInfo.address,
                    currencyCode: listingInfo.currencyCode,
                    personCapacity: listingInfo.personCapacity,
                    petFee: listingInfo.airbnbPetFeeAmount,
                    checkOutTime: listingInfo.checkOutTime,
                    checkInTimeStart: listingInfo.checkInTimeStart,
                    checkInTimeEnd: listingInfo.checkInTimeEnd,
                    squareMeters: listingInfo.squareMeters,
                    wifiUsername: listingInfo.wifiUsername,
                    wifiPassword: listingInfo.wifiPassword,
                    minNights: listingInfo.minNights,
                    maxNights: listingInfo.maxNights,
                    propertyLicenseNumber: listingInfo.propertyLicenseNumber,
                    createdBy: userId,
                    clientProperty: savedProperty,
                  });

                  const vendorManagementInfo = transactionalEntityManager.create(PropertyVendorManagement, {
                    cleaningFee: listingInfo.cleaningFee,
                  });
                  const savedVendorManagementInfo = await transactionalEntityManager.save(vendorManagementInfo);
                  propertyInfo.vendorManagementInfo = savedVendorManagementInfo;

                  const savedPropertyInfo = await transactionalEntityManager.save(propertyInfo);
                  savedProperty.propertyInfo = savedPropertyInfo;
                  await transactionalEntityManager.save(savedProperty);
                }

                // Update or create serviceInfo
                if (serviceType || managementFee) {
                  if (existingProperty.serviceInfo) {
                    existingProperty.serviceInfo.serviceType = serviceType;
                    existingProperty.serviceInfo.managementFee = managementFee;
                    existingProperty.serviceInfo.updatedBy = userId;
                    await transactionalEntityManager.save(existingProperty.serviceInfo);
                    logger.info(`✅ Updated service info for listingId: ${listingId} - ServiceType: ${serviceType}, ManagementFee: ${managementFee}`);
                  } else {
                    const propertyServiceInfo = transactionalEntityManager.create(PropertyServiceInfo, {
                      serviceType: serviceType,
                      managementFee: managementFee,
                      createdBy: userId,
                      clientProperty: savedProperty,
                    });
                    const savedServiceInfo = await transactionalEntityManager.save(propertyServiceInfo);
                    savedProperty.serviceInfo = savedServiceInfo;
                    await transactionalEntityManager.save(savedProperty);
                    logger.info(`✅ Created service info for listingId: ${listingId} - ServiceType: ${serviceType}, ManagementFee: ${managementFee}`);
                  }
                }
              } else {
                // Create new property
                logger.info(`✨ Creating new property for listingId: ${listingId}`);
                const property = transactionalEntityManager.create(ClientPropertyEntity, {
                  listingId,
                  address: listingInfo.address,
                  status: PropertyStatus.ACTIVE,
                  createdBy: userId,
                  client: client,
                });

                savedProperty = await transactionalEntityManager.save(property);

                // Create propertyInfo
                const propertyInfo = transactionalEntityManager.create(PropertyInfo, {
                  externalListingName: listingInfo.externalListingName,
                  internalListingName: listingInfo.internalListingName,
                  price: listingInfo.price,
                  priceForExtraPerson: listingInfo.priceForExtraPerson,
                  propertyTypeId: listingInfo.propertyTypeId != null ? String(listingInfo.propertyTypeId) : null,
                  roomType: listingInfo.roomType,
                  bedroomsNumber: listingInfo.bedroomsNumber,
                  bathroomsNumber: listingInfo.bathroomsNumber,
                  bathroomType: listingInfo.bathroomType,
                  guestBathroomsNumber: listingInfo.guestBathroomsNumber,
                  address: listingInfo.address,
                  currencyCode: listingInfo.currencyCode,
                  personCapacity: listingInfo.personCapacity,
                  petFee: listingInfo.airbnbPetFeeAmount,
                  checkOutTime: listingInfo.checkOutTime,
                  checkInTimeStart: listingInfo.checkInTimeStart,
                  checkInTimeEnd: listingInfo.checkInTimeEnd,
                  squareMeters: listingInfo.squareMeters,
                  wifiUsername: listingInfo.wifiUsername,
                  wifiPassword: listingInfo.wifiPassword,
                  minNights: listingInfo.minNights,
                  maxNights: listingInfo.maxNights,
                  propertyLicenseNumber: listingInfo.propertyLicenseNumber,
                  createdBy: userId,
                  clientProperty: savedProperty,
                });

                const vendorManagementInfo = transactionalEntityManager.create(PropertyVendorManagement, {
                  cleaningFee: listingInfo.cleaningFee,
                });
                const savedVendorManagementInfo = await transactionalEntityManager.save(vendorManagementInfo);
                propertyInfo.vendorManagementInfo = savedVendorManagementInfo;

                const savedPropertyInfo = await transactionalEntityManager.save(propertyInfo);
                savedProperty.propertyInfo = savedPropertyInfo;
                await transactionalEntityManager.save(savedProperty);

                // Create serviceInfo
                if (serviceType || managementFee) {
                  const propertyServiceInfo = transactionalEntityManager.create(PropertyServiceInfo, {
                    serviceType: serviceType,
                    managementFee: managementFee,
                    createdBy: userId,
                    clientProperty: savedProperty,
                  });
                  const savedServiceInfo = await transactionalEntityManager.save(propertyServiceInfo);
                  savedProperty.serviceInfo = savedServiceInfo;
                  await transactionalEntityManager.save(savedProperty);
                  logger.info(`✅ Created service info for listingId: ${listingId} - ServiceType: ${serviceType}, ManagementFee: ${managementFee}`);
                }
              }

              logger.info(`✅ Successfully processed property for listingId: ${listingId}`);
            }
          }
        });

        // Only add to successful if the entire transaction succeeds
        successfullyProcessedData.push(row);
      } catch (error) {
        failedToProcessData.push({ ...row, reason: `Error processing client: ${error}` });
        logger.error(`Error processing client for row ${JSON.stringify(row)}: ${error}`);
        continue;
      }



    }

    fs.unlinkSync(filePath); // Delete the file after processing

    return { successfullyProcessedData, failedToProcessData };
  }


  async publishPropertyToHostify(propertyId: string, userId: string) {
    const listingIntake = await this.propertyRepo.findOne({
      where: { id: propertyId },
      relations: ["onboarding", "serviceInfo", "propertyInfo", "propertyInfo.propertyBedTypes", "propertyInfo.propertyUpsells", "client"]
    });


    if (!listingIntake) {
      throw CustomErrorHandler.notFound(`Property with ID ${propertyId} not found.`);
    }

    // Here you would implement the logic to publish the property to Hostaway
    // This is a placeholder for the actual implementation
    logger.info("Publishing property to Hostaway");

    // Simulate successful publishing
    let status = this.getListingIntakeStatus(listingIntake.propertyInfo);
    if (status === "draft") {
      throw CustomErrorHandler.forbidden("Missing required fields. Cannot be published to Hostaway.");
    }
    if (listingIntake.listingId) {
      throw CustomErrorHandler.forbidden("Property is already published to Hostaway.");
    }

    //prepare hostaway payload
    const hostawayPayload = {
      name: listingIntake.propertyInfo.externalListingName,
      externalListingName: listingIntake.propertyInfo.externalListingName,
      internalListingName: listingIntake.propertyInfo.internalListingName,
      price: listingIntake.propertyInfo.price || 3000,
      priceForExtraPerson: listingIntake.propertyInfo.priceForExtraPerson || 0,
      propertyTypeId: listingIntake.propertyInfo.propertyTypeId,
      roomType: listingIntake.propertyInfo.roomType,
      bedroomsNumber: listingIntake.propertyInfo.bedroomsNumber,
      bathroomsNumber: listingIntake.propertyInfo.bathroomsNumber,
      bathroomType: listingIntake.propertyInfo.bathroomType,
      guestBathroomsNumber: listingIntake.propertyInfo.guestBathroomsNumber,
      address: listingIntake.address,
      timeZoneName: listingIntake.client.timezone,
      currencyCode: listingIntake.propertyInfo.currencyCode || "USD",
      personCapacity: listingIntake.propertyInfo.personCapacity,
      cleaningFee: listingIntake.propertyInfo?.vendorManagementInfo?.cleaningFee || null,
      airbnbPetFeeAmount: listingIntake.propertyInfo.petFee,
      checkOutTime: listingIntake.propertyInfo.checkOutTime,
      checkInTimeStart: listingIntake.propertyInfo.checkInTimeStart,
      checkInTimeEnd: listingIntake.propertyInfo.checkInTimeEnd,
      squareMeters: listingIntake.propertyInfo.squareMeters,
      language: "en",
      instantBookable: listingIntake.propertyInfo?.canAnyoneBookAnytime?.includes("Yes") || false,
      instantBookableLeadTime: listingIntake.propertyInfo.leadTimeDays || null,
      wifiUsername: listingIntake.propertyInfo.wifiUsername,
      wifiPassword: listingIntake.propertyInfo.wifiPassword,
      minNights: listingIntake.propertyInfo.minNights,
      maxNights: listingIntake.propertyInfo.maxNights,
      contactName: "Luxury Lodging",
      contactPhone1: "(813) 531-8988",
      contactLanguage: "English",
      guestsIncluded: listingIntake.propertyInfo.guestsIncluded || 1,

      amenities: listingIntake.propertyInfo?.amenities?.map((amenity: any) => {
        return { amenityId: Number(amenity) };
      }),

      listingBedTypes: listingIntake.propertyInfo?.propertyBedTypes?.filter((bedType: any) => bedType.bedTypeId && bedType.quantity && bedType.bedroomNumber)
        .map(bedType => ({
          bedTypeId: bedType.bedTypeId,
          quantity: bedType.quantity,
          bedroomNumber: bedType.bedroomNumber,
        })),

      propertyLicenseNumber: listingIntake.propertyInfo.propertyLicenseNumber,
    };

    logger.info(JSON.stringify(hostawayPayload));

    //simulate taking time of 10s
    // await new Promise(resolve => setTimeout(resolve, 10000));

    const response = await this.hostawayClient.createListing(hostawayPayload);
    if (!response) {
      throw new CustomErrorHandler(500, "Failed to publish listing intake to Hostaway");
    }
    // Update the listingIntake status to published
    listingIntake.status = PropertyStatus.ACTIVE;
    listingIntake.listingId = response.id; // Assuming response contains the Hostaway listing ID
    listingIntake.updatedBy = userId;
    await this.propertyRepo.save(listingIntake);

    return { message: "Property published to Hostaway successfully", listingIntake };
  }


}