import { appDatabase } from "../utils/database.util";
import { ClientEntity } from "../entity/Client";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { ClientSecondaryContact } from "../entity/ClientSecondaryContact";
import CustomErrorHandler from "../middleware/customError.middleware";
import { In, IsNull, Not } from "typeorm";
import { ListingService } from "./ListingService";
import { tagIds } from "../constant"
import { ClientTicket } from "../entity/ClientTicket";

interface ClientFilter {
  page: number;
  limit: number;
  keyword?: string;
  listingId?: string[];
  serviceType?: string[];
  status?: string[];
}

export class ClientService {
  private clientRepo = appDatabase.getRepository(ClientEntity);
  private propertyRepo = appDatabase.getRepository(ClientPropertyEntity);
  private contactRepo = appDatabase.getRepository(ClientSecondaryContact);
  private clientTicketRepo = appDatabase.getRepository(ClientTicket);

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


}
