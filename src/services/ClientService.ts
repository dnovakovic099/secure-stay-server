import { appDatabase } from "../utils/database.util";
import { ClientEntity } from "../entity/Client";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { ClientSecondaryContact } from "../entity/ClientSecondaryContact";
import CustomErrorHandler from "../middleware/customError.middleware";
import { IsNull, Not } from "typeorm";

interface ClientFilter {
  page: number;
  limit: number;
  search?: string;
  listingId?: string[];
  serviceType?: string[];
  status?: string[];
}

export class ClientService {
  private clientRepo = appDatabase.getRepository(ClientEntity);
  private propertyRepo = appDatabase.getRepository(ClientPropertyEntity);
  private contactRepo = appDatabase.getRepository(ClientSecondaryContact);

  async saveClient(
    clientData: Partial<ClientEntity>,
    userId: string,
    secondaryContacts?: Partial<ClientSecondaryContact>[],
    clientProperties?: string[],
  ) {
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

  async getClientList(filter: ClientFilter) {
    const { page, limit, search } = filter;

    // fetch the associated clientSecondaryContacts and clientProperties as well
    const query = this.clientRepo.createQueryBuilder("client")
      .leftJoinAndSelect("client.secondaryContacts", "secondaryContact", "secondaryContact.deletedAt IS NULL")
      .leftJoinAndSelect("client.properties", "property", "property.deletedAt IS NULL")
      .where("client.deletedAt IS NULL");

    if (search) {
      query.andWhere("client.firstName ILIKE :search OR client.lastName ILIKE :search OR client.email ILIKE :search", { search: `%${search}%` });
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
    return { data, total };
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

      return { totalActiveClients, ...serviceTypeCounts };
   }



}
