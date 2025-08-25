import { appDatabase } from "../utils/database.util";
import { ClientEntity } from "../entity/Client";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ILike, In, Between } from "typeorm";

interface FilterQuery {
  page: number;
  limit: number;
  search?: string;
  status?: string[];
  clientType?: string[];
  source?: string[];
  city?: string[];
  state?: string[];
  country?: string[];
  tags?: string[];
  minTotalSpent?: number;
  maxTotalSpent?: number;
  minTotalBookings?: number;
  maxTotalBookings?: number;
  startDate?: Date;
  endDate?: Date;
}

interface ClientStats {
  totalClients: number;
  activeClients: number;
  inactiveClients: number;
  pendingClients: number;
  suspendedClients: number;
  totalRevenue: number;
  averageRevenuePerClient: number;
  topClientTypes: Array<{ type: string; count: number }>;
  topSources: Array<{ source: string; count: number }>;
}

export class ClientService {
  private clientRepo = appDatabase.getRepository(ClientEntity);

  async createClient(body: Partial<ClientEntity>, userId: string) {
    // Check if email already exists
    const existingClient = await this.clientRepo.findOneBy({ email: body.email });
    if (existingClient) {
      throw CustomErrorHandler.alreadyExists("Client with this email already exists.");
    }

    const client = this.clientRepo.create({
      ...body,
      createdBy: userId,
      updatedBy: userId,
    });

    return await this.clientRepo.save(client);
  }

  async updateClient(id: string, body: Partial<ClientEntity>, userId: string) {
    const existingClient = await this.clientRepo.findOneBy({ id });
    if (!existingClient) {
      throw CustomErrorHandler.notFound(`Client with ID ${id} not found.`);
    }

    // Check if email is being changed and if it already exists
    if (body.email && body.email !== existingClient.email) {
      const emailExists = await this.clientRepo.findOneBy({ email: body.email });
      if (emailExists) {
        throw CustomErrorHandler.alreadyExists("Client with this email already exists.");
      }
    }

    const updatedClient = this.clientRepo.merge(existingClient, {
      ...body,
      updatedBy: userId,
    });

    return await this.clientRepo.save(updatedClient);
  }

  async deleteClient(id: string, userId: string) {
    const client = await this.clientRepo.findOneBy({ id });
    if (!client) {
      throw CustomErrorHandler.notFound(`Client with ID ${id} not found.`);
    }

    client.deletedBy = userId;
    await this.clientRepo.save(client);
    return await this.clientRepo.softRemove(client);
  }

  async getClients(query: FilterQuery, userId: string) {
    const {
      page,
      limit,
      search,
      status,
      clientType,
      source,
      city,
      state,
      country,
      tags,
      minTotalSpent,
      maxTotalSpent,
      minTotalBookings,
      maxTotalBookings,
      startDate,
      endDate,
    } = query;

    const queryBuilder = this.clientRepo.createQueryBuilder("client");

    // Apply filters
    if (search) {
      queryBuilder.andWhere(
        "(client.fullName ILIKE :search OR client.email ILIKE :search OR client.companyName ILIKE :search OR client.phone ILIKE :search)",
        { search: `%${search}%` }
      );
    }

    if (status && status.length > 0) {
      queryBuilder.andWhere("client.status IN (:...status)", { status });
    }

    if (clientType && clientType.length > 0) {
      queryBuilder.andWhere("client.clientType IN (:...clientType)", { clientType });
    }

    if (source && source.length > 0) {
      queryBuilder.andWhere("client.source IN (:...source)", { source });
    }

    if (city && city.length > 0) {
      queryBuilder.andWhere("client.city IN (:...city)", { city });
    }

    if (state && state.length > 0) {
      queryBuilder.andWhere("client.state IN (:...state)", { state });
    }

    if (country && country.length > 0) {
      queryBuilder.andWhere("client.country IN (:...country)", { country });
    }

    if (tags && tags.length > 0) {
      queryBuilder.andWhere("client.tags && :tags", { tags });
    }

    if (minTotalSpent !== undefined) {
      queryBuilder.andWhere("client.totalSpent >= :minTotalSpent", { minTotalSpent });
    }

    if (maxTotalSpent !== undefined) {
      queryBuilder.andWhere("client.totalSpent <= :maxTotalSpent", { maxTotalSpent });
    }

    if (minTotalBookings !== undefined) {
      queryBuilder.andWhere("client.totalBookings >= :minTotalBookings", { minTotalBookings });
    }

    if (maxTotalBookings !== undefined) {
      queryBuilder.andWhere("client.totalBookings <= :maxTotalBookings", { maxTotalBookings });
    }

    if (startDate && endDate) {
      queryBuilder.andWhere("client.createdAt BETWEEN :startDate AND :endDate", {
        startDate,
        endDate,
      });
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination and ordering
    const clients = await queryBuilder
      .orderBy("client.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      clients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getClientsByIds(ids: string[]) {
    return await this.clientRepo.findBy({ id: In(ids) });
  }

  async getClientById(id: string) {
    const client = await this.clientRepo.findOneBy({ id });
    if (!client) {
      throw CustomErrorHandler.notFound(`Client with ID ${id} not found.`);
    }
    return client;
  }

  async searchClients(searchTerm: string, filters?: any) {
    const queryBuilder = this.clientRepo.createQueryBuilder("client");

    // Apply search
    queryBuilder.andWhere(
      "(client.fullName ILIKE :search OR client.email ILIKE :search OR client.companyName ILIKE :search OR client.phone ILIKE :search)",
      { search: `%${searchTerm}%` }
    );

    // Apply additional filters
    if (filters) {
      if (filters.status && filters.status.length > 0) {
        queryBuilder.andWhere("client.status IN (:...status)", { status: filters.status });
      }

      if (filters.clientType && filters.clientType.length > 0) {
        queryBuilder.andWhere("client.clientType IN (:...clientType)", { clientType: filters.clientType });
      }

      if (filters.source && filters.source.length > 0) {
        queryBuilder.andWhere("client.source IN (:...source)", { source: filters.source });
      }
    }

    return await queryBuilder
      .orderBy("client.fullName", "ASC")
      .take(50)
      .getMany();
  }

  async getClientStats(): Promise<ClientStats> {
    const [
      totalClients,
      activeClients,
      inactiveClients,
      pendingClients,
      suspendedClients,
      totalRevenue,
      averageRevenue,
      clientTypes,
      sources,
    ] = await Promise.all([
      this.clientRepo.count(),
      this.clientRepo.countBy({ status: "Active" }),
      this.clientRepo.countBy({ status: "Inactive" }),
      this.clientRepo.countBy({ status: "Pending" }),
      this.clientRepo.countBy({ status: "Suspended" }),
      this.clientRepo
        .createQueryBuilder("client")
        .select("SUM(client.totalSpent)", "total")
        .getRawOne(),
      this.clientRepo
        .createQueryBuilder("client")
        .select("AVG(client.totalSpent)", "average")
        .getRawOne(),
      this.clientRepo
        .createQueryBuilder("client")
        .select("client.clientType", "type")
        .addSelect("COUNT(*)", "count")
        .groupBy("client.clientType")
        .orderBy("count", "DESC")
        .limit(5)
        .getRawMany(),
      this.clientRepo
        .createQueryBuilder("client")
        .select("client.source", "source")
        .addSelect("COUNT(*)", "count")
        .groupBy("client.source")
        .orderBy("count", "DESC")
        .limit(5)
        .getRawMany(),
    ]);

    return {
      totalClients,
      activeClients,
      inactiveClients,
      pendingClients,
      suspendedClients,
      totalRevenue: parseFloat(totalRevenue?.total || "0"),
      averageRevenuePerClient: parseFloat(averageRevenue?.average || "0"),
      topClientTypes: clientTypes.map((item: any) => ({
        type: item.type,
        count: parseInt(item.count),
      })),
      topSources: sources.map((item: any) => ({
        source: item.source,
        count: parseInt(item.count),
      })),
    };
  }

  async updateClientStats(clientId: string, bookingData: { amount: number; date: Date }) {
    const client = await this.clientRepo.findOneBy({ id: clientId });
    if (!client) {
      throw CustomErrorHandler.notFound(`Client with ID ${clientId} not found.`);
    }

    client.totalBookings += 1;
    client.totalSpent += bookingData.amount;
    client.lastBookingDate = bookingData.date;

    return await this.clientRepo.save(client);
  }
}
