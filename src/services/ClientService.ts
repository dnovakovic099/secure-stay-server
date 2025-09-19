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

interface ClientFilter {
  page: number;
  limit: number;
  keyword?: string;
  listingId?: string[];
  serviceType?: string[];
  status?: string[];
}

// types/propertyOnboarding.ts
interface PropertyOnboardingRequest {
  clientId: string;
  clientProperties: Property[];
}

interface Property {
  address: string;
  onboarding: Onboarding;
}

interface Onboarding {
  serviceInfo: ServiceInfo;
  sales: Sales;
  listing: Listing;
  photography: Photography;
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
}

interface Photography {
  photographyCoverage:
  | "Yes (Covered by Luxury Lodging)"
  | "Yes (Covered by Client)"
  | "No"
  | null;
  photographyNotes: string | null;
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

  async saveClient(
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
    }

    const client = this.clientRepo.create({ ...clientData, createdBy: userId });

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

    // Proper update loop using id
    for (const property of clientProperties as Array<Property & { id: string; }>) {
      const clientProperty = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["onboarding", "serviceInfo"] });
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

      // Update Service Info if provided
      if (property.onboarding?.serviceInfo) {
        const siPayload = property.onboarding.serviceInfo;
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

      // Update Onboarding if provided
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

      const refreshed = await this.propertyRepo.findOne({ where: { id: property.id }, relations: ["onboarding", "serviceInfo"] });
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
      // Create ClientProperty
      const clientProperty = this.propertyRepo.create({
        address: property.address,
        client: { id: clientId } as any,
        createdBy: userId,
      });
      const savedClientProperty = await this.propertyRepo.save(clientProperty);

      // Map Onboarding (sales, listing, photography) - no serviceInfo for internal onboarding
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
        actualLiveDate: listing?.actualLiveDate ?? null,
        actualStartDate: listing?.actualStartDate ?? null,
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

      results.push({ clientProperty: savedClientProperty, onboarding: savedOnboarding });
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
    const { clientId, clientProperties } = body as PropertyOnboardingRequest;
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw CustomErrorHandler.notFound("Client not found");
    }

    const results: Array<{ clientProperty: ClientPropertyEntity; serviceInfo: PropertyServiceInfo; }> = [];

    for (const property of clientProperties) {
      // create client property (address) if needed
      const clientProperty = this.propertyRepo.create({
        address: property.address,
        client: { id: clientId } as any,
        createdBy: userId,
      });
      const savedClientProperty = await this.propertyRepo.save(clientProperty);

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

      results.push({ clientProperty: savedClientProperty, serviceInfo: savedServiceInfo });
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



}
