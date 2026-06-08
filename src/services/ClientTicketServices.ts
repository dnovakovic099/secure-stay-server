import { Between, ILike, In, Like, Raw } from "typeorm";
import { ClientTicket } from "../entity/ClientTicket";
import { ClientTicketUpdates } from "../entity/ClientTicketUpdates";
import { appDatabase } from "../utils/database.util";
import CustomErrorHandler from "../middleware/customError.middleware";
import { UsersEntity } from "../entity/Users";
import { ListingService } from "./ListingService";
import { tagIds } from "../constant";
import { generateSlackMessageLink } from "../helpers/helpers";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";

interface LatestUpdates {
  id?: number;
  updates: string;
  isDeleted?: boolean;
}

interface ClientTicketFilter {
  status?: string[];
  listingId?: string[];
  category?: string[];
  fromDate?: string;
  toDate?: string;
  page: number;
  limit: number;
  ids?: number[];
  propertyType?: string[];
  serviceType?: string[];
  dateType?: string;
  urgency?: number[] | number;
  clientSatisfaction?: number[] | number;
  keyword?: string;
  keywordField?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export class ClientTicketService {
  private clientTicketRepo = appDatabase.getRepository(ClientTicket);
  private clientTicketUpdateRepo =
    appDatabase.getRepository(ClientTicketUpdates);
  private usersRepo = appDatabase.getRepository(UsersEntity);

  private async createClientTicket(
    ticketData: Partial<ClientTicket>,
    userId: string
  ) {
    const newTicket = this.clientTicketRepo.create({
      ...ticketData,
      createdBy: userId,
    });
    return await this.clientTicketRepo.save(newTicket);
  }

  private async createClientTicketUpdates(
    clientTicket: ClientTicket,
    latestUpdates: LatestUpdates[],
    userId: string
  ) {
    const updatesToSave = latestUpdates.map((update) => {
      const newUpdate = this.clientTicketUpdateRepo.create({
        ...update,
        clientTicket: clientTicket,
        createdBy: userId,
      });
      return newUpdate;
    });
    return await this.clientTicketUpdateRepo.save(updatesToSave);
  }

  public async saveClientTicketUpdates(body: any, userId: string) {
    const { ticketId, updates } = body;

    const clientTicket = await this.clientTicketRepo.findOne({
      where: { id: ticketId },
    });
    if (!clientTicket) {
      throw CustomErrorHandler.notFound(
        `Client ticket with id ${ticketId} not found`
      );
    }

    const newUpdate = this.clientTicketUpdateRepo.create({
      updates,
      clientTicket,
      createdBy: userId,
    });

    await this.clientTicketUpdateRepo.save(newUpdate);
    const users = await this.usersRepo.find();
    const userMap = new Map(
      users.map((user) => [user.uid, `${user?.firstName} ${user?.lastName}`])
    );

    newUpdate.createdBy =
      userMap.get(newUpdate.createdBy) || newUpdate.createdBy;
    newUpdate.updatedBy =
      userMap.get(newUpdate.updatedBy) || newUpdate.updatedBy;
    return newUpdate;
  }

  public async saveClientTicketWithUpdates(body: any, userId: string) {
    const { latestUpdates, mentions } = body;
    const ticketData: Partial<ClientTicket> = {
      status: body.status,
      listingId: body.listingId,
      category: JSON.stringify(body.category),
      description: body.description,
      resolution: body.resolution,
      clientSatisfaction: body.clientSatisfaction,
      assignee: body.assignee || null,
      urgency: body.urgency || null,
      mistake: body.mistake || null,
      mistakeResolvedOn: body.mistake === "Resolved" ? format(new Date(), "yyyy-MM-dd") : null,
      dueDate: body.dueDate || null,
    };

    const clientTicket = await this.createClientTicket(ticketData, userId);
    latestUpdates &&
      (await this.createClientTicketUpdates(
        clientTicket,
        latestUpdates,
        userId
      ));

    const users = await this.usersRepo.find();
    const userMap = new Map(
      users.map((user) => [user.uid, `${user?.firstName} ${user?.lastName}`])
    );

    clientTicket.createdBy =
      userMap.get(clientTicket.createdBy) || clientTicket.createdBy;
    clientTicket.updatedBy =
      userMap.get(clientTicket.updatedBy) || clientTicket.updatedBy;
    return clientTicket;
  }

  public async getClientTicket(body: ClientTicketFilter, userId: string) {
    const {
      status,
      listingId,
      category,
      fromDate,
      toDate,
      page,
      limit,
      ids,
      propertyType,
      serviceType,
      dateType,
      urgency,
      clientSatisfaction,
      keyword,
      keywordField,
      sortBy,
      sortOrder,
    } = body;

    const users = await this.usersRepo.find();
    const userMap = new Map(
      users.map((user) => [user.uid, `${user?.firstName} ${user?.lastName}`])
    );

    let listingIds = [];
    const listingService = new ListingService();

    if (propertyType?.length || serviceType?.length) {
      const [propertyTypeListings, serviceTypeListings] = await Promise.all([
        propertyType?.length ? listingService.getListingsByPropertyTypes(propertyType, userId) : Promise.resolve([]),
        serviceType?.length ? listingService.getListingsByServiceTypes(serviceType, userId) : Promise.resolve([]),
      ]);
      const propertyTypeIds = propertyTypeListings.map((listing) => Number(listing.id));
      const serviceTypeIds = serviceTypeListings.map((listing) => Number(listing.id));
      listingIds = propertyTypeIds.length && serviceTypeIds.length
        ? propertyTypeIds.filter((id) => serviceTypeIds.includes(id))
        : [...propertyTypeIds, ...serviceTypeIds];
      if (!listingIds.length) listingIds = [-1];
    } else {
      listingIds = listingId;
    }

    const requestedIds = ids?.length ? ids.map(Number) : [];
    const applyTicketIds = (where: any, ticketIds: number[]) => {
      const normalizedIds = Array.from(new Set(ticketIds.map(Number).filter(Boolean)));
      const finalIds = requestedIds.length
        ? normalizedIds.filter((id) => requestedIds.includes(id))
        : normalizedIds;
      return { ...where, id: In(finalIds.length ? finalIds : [-1]) };
    };

    const selectedDateField = dateType === "updatedAt" ? "updatedAt" : dateType === "completedOn" ? "completedOn" : "createdAt";
    const dateRangeFilter = fromDate && toDate
      ? {
          [selectedDateField]: Between(
            new Date(fromDate),
            new Date(new Date(toDate).setHours(23, 59, 59, 999))
          ),
        }
      : {};
    const normalizedUrgency = Array.isArray(urgency)
      ? urgency.map(Number).filter((value) => Number.isFinite(value))
      : urgency
        ? [Number(urgency)].filter((value) => Number.isFinite(value))
        : [];
    const normalizedClientSatisfaction = Array.isArray(clientSatisfaction)
      ? clientSatisfaction.map(Number).filter((value) => Number.isFinite(value))
      : clientSatisfaction
        ? [Number(clientSatisfaction)].filter((value) => Number.isFinite(value))
        : [];

    const baseWhere = {
        ...(requestedIds.length > 0 && { id: In(requestedIds) }),
        ...(status && status.length > 0 && { status: In(status) }),
        ...(normalizedUrgency.length > 0 && { urgency: In(normalizedUrgency) }),
        ...(normalizedClientSatisfaction.length > 0 && { clientSatisfaction: In(normalizedClientSatisfaction) }),
        ...(listingIds &&
          listingIds.length > 0 && { listingId: In(listingIds) }),
        ...(category &&
          category.length > 0 && {
            category: Raw((alias) =>
              category.map((cat) => `${alias} LIKE '%${cat}%'`).join(" OR ")
            ),
          }),
        ...dateRangeFilter,
      };
    const keywordFields = ["description", "resolution"];
    const selectedKeywordField = keywordFields.includes(String(keywordField || "")) ? String(keywordField) : "all";
    const latestUpdateTicketIds = keyword && (selectedKeywordField === "all" || keywordField === "latestUpdate")
      ? (await this.clientTicketUpdateRepo
        .createQueryBuilder("ticketUpdate")
        .leftJoin("ticketUpdate.clientTicket", "ticket")
        .select("DISTINCT ticket.id", "id")
        .where("ticketUpdate.updates LIKE :keyword", { keyword: `%${keyword}%` })
        .getRawMany()).map((row) => Number(row.id))
      : [];
    const where = keyword
      ? keywordField === "latestUpdate"
        ? applyTicketIds(baseWhere, latestUpdateTicketIds)
        : selectedKeywordField === "all"
          ? [
            ...keywordFields.map((field) => ({ ...baseWhere, [field]: ILike(`%${keyword}%`) })),
            ...(latestUpdateTicketIds.length ? [applyTicketIds(baseWhere, latestUpdateTicketIds)] : []),
          ]
          : { ...baseWhere, [selectedKeywordField]: ILike(`%${keyword}%`) }
      : baseWhere;
    const sortColumnMap: Record<string, string> = {
      id: "id",
      status: "status",
      listingName: "listingId",
      category: "category",
      description: "description",
      clientTicketUpdates: "updatedAt",
      urgency: "urgency",
      dueDate: "dueDate",
      mistake: "mistake",
      resolution: "resolution",
      clientSatisfaction: "clientSatisfaction",
      createdAt: "createdAt",
      createdBy: "createdBy",
      updatedAt: "updatedAt",
      updatedBy: "updatedBy",
      assigneeName: "assignee",
    };
    const sortColumn = sortBy ? sortColumnMap[sortBy] : null;

    const [clientTickets, total] = await this.clientTicketRepo.findAndCount({
      where,
      relations: ["clientTicketUpdates"],
      skip: (page - 1) * limit,
      take: limit,
      order: sortColumn
        ? { [sortColumn]: sortOrder || 'DESC' }
        : { id: 'DESC' },
    });

    const listings = await listingService.getAllListingsForLookup();

    const transformedTickets = clientTickets.map((ticket) => {
      return {
        ...ticket,
        listingName: listings.find(
          (listing) => listing.id == Number(ticket.listingId)
        )?.internalListingName,
        serviceType: ListingService.extractServiceTypeFromTags(listings.find(
          (listing) => listing.id == Number(ticket.listingId)
        )?.tags),
        createdBy: userMap.get(ticket.createdBy) || ticket.createdBy,
        updatedBy: userMap.get(ticket.updatedBy) || ticket.updatedBy,
        clientTicketUpdates: ticket.clientTicketUpdates.map((update) => ({
          ...update,
          createdBy: userMap.get(update.createdBy) || update.createdBy,
          updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
        })),
        assigneeName: userMap.get(ticket.assignee) || ticket.assignee,
        assigneeList: users.map((user) => {
          return { uid: user.uid, name: `${user.firstName} ${user.lastName}` };
        }),
      };
    });

    return {
      clientTickets: transformedTickets,
      total,
    };
  }

  public async getClientTicketById(id: number) {
    const clientTicket = await this.clientTicketRepo.findOne({
      where: { id },
      relations: ["clientTicketUpdates"],
    });

    if (!clientTicket) {
      throw CustomErrorHandler.notFound(`Client ticket with ID ${id} not found.`);
    }

    const slackMessage = await appDatabase.getRepository(SlackMessageEntity).findOne({ where: { entityType: "client_ticket", entityId: id } });
    let slackLink = "";
    if (slackMessage) {
      slackLink = generateSlackMessageLink(process.env.SLACK_WORKSPACE_URL, slackMessage.channel, slackMessage.messageTs);
    }

    const users = await this.usersRepo.find();
    const userMap = new Map(users.map((user) => [user.uid, `${user?.firstName} ${user?.lastName}`]));

    clientTicket.createdBy = userMap.get(clientTicket.createdBy) || clientTicket.createdBy;
    clientTicket.updatedBy = userMap.get(clientTicket.updatedBy) || clientTicket.updatedBy;
    clientTicket.clientTicketUpdates = clientTicket.clientTicketUpdates.map(
      (update) => ({
        ...update,
        createdBy: userMap.get(update.createdBy) || update.createdBy,
        updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
      })
    );

    return { clientTicket, slackLink };
  }

  public async updateClientTicketUpdates(
    ticketId: number,
    updates: LatestUpdates[],
    userId: string
  ) {
    const { clientTicket } = await this.getClientTicketById(ticketId);
    if (!clientTicket) {
      throw CustomErrorHandler.notFound(
        `Client ticket with ID ${ticketId} not found.`
      );
    }

    // if updates have id then update that particular clientTicketUpdate else create new clientTicketupdate
    const updatesToSave = updates.map((update) => {
      if (update.id) {
        return this.clientTicketUpdateRepo.save({
          ...update,
          updatedBy: userId,
          clientTicket: clientTicket,
          ...(update.isDeleted && { deletedBy: userId, deletedAt: new Date() }),
        });
      } else {
        const newUpdate = this.clientTicketUpdateRepo.create({
          ...update,
          clientTicket: clientTicket,
          createdBy: userId,
        });
        return this.clientTicketUpdateRepo.save(newUpdate);
      }
    });

    return await Promise.all(updatesToSave);
  }

  public async updateClientTicketWithUpdates(body: any, userId: string) {
    const { latestUpdates, id } = body;
    const ticketData: Partial<ClientTicket> = {
      status: body.status,
      listingId: body.listingId,
      category: JSON.stringify(body.category),
      description: body.description,
      resolution: body.resolution,
      clientSatisfaction: body.clientSatisfaction,
      assignee: body.assignee || null,
      urgency: body.urgency || null,
      mistake: body.mistake || null,
      mistakeResolvedOn: body.mistake === "Resolved" ? format(new Date(), "yyyy-MM-dd") : null,
      dueDate: body.dueDate || null,
    };

    const clientTicket = await this.clientTicketRepo.findOne({ where: { id } });
    if (!clientTicket) {
      throw CustomErrorHandler.notFound(
        `Client ticket with ID ${id} not found.`
      );
    }

    Object.assign(clientTicket, ticketData, {
      updatedBy: userId,
      updatedAt: new Date(),
      ...(clientTicket.status !== "Completed" &&
        ticketData.status == "Completed" && {
          completedOn: new Date(),
          completedBy: userId,
        }),
    });
    await this.clientTicketRepo.save(clientTicket);
    latestUpdates &&
      (await this.updateClientTicketUpdates(id, latestUpdates, userId));

    return clientTicket;
  }

  public async deleteClientTicket(id: number, userId: string) {
    const clientTicket = await this.clientTicketRepo.findOne({ where: { id } });
    if (!clientTicket) {
      throw CustomErrorHandler.notFound(
        `Client ticket with ID ${id} not found.`
      );
    }

    clientTicket.deletedBy = userId;
    clientTicket.deletedAt = new Date();
    await this.clientTicketRepo.save(clientTicket);

    return { message: `Client ticket with ID ${id} deleted successfully.` };
  }

  public async updateClientTicketStatus(
    id: number,
    status: string,
    userId: string
  ) {
    const clientTicket = await this.clientTicketRepo.findOne({ where: { id } });
    if (!clientTicket) {
      throw CustomErrorHandler.notFound(
        `Client ticket with ID ${id} not found.`
      );
    }

    clientTicket.status = status;
    clientTicket.updatedBy = userId;

    if (status === "Completed") {
      clientTicket.completedOn = new Date().toISOString();
      clientTicket.completedBy = userId;
    } else {
      clientTicket.completedOn = null;
      clientTicket.completedBy = null;
    }

    await this.clientTicketRepo.save(clientTicket);

    const users = await this.usersRepo.find();
    const userMap = new Map(
      users.map((user) => [user.uid, `${user?.firstName} ${user?.lastName}`])
    );

    clientTicket.createdBy =
      userMap.get(clientTicket.createdBy) || clientTicket.createdBy;
    clientTicket.updatedBy =
      userMap.get(clientTicket.updatedBy) || clientTicket.updatedBy;
    return clientTicket;
  }

  public async updateTicketUpdates(body: any, userId: string) {
    const { id, updates } = body;
    const ticketUpdates = await this.clientTicketUpdateRepo.findOne({
      where: { id },
    });
    if (!ticketUpdates) {
      throw CustomErrorHandler.notFound(`Ticket update with ${id} not found.`);
    }

    ticketUpdates.updates = updates;
    ticketUpdates.updatedBy = userId;

    await this.clientTicketUpdateRepo.save(ticketUpdates);

    const users = await this.usersRepo.find();
    const userMap = new Map(
      users.map((user) => [user.uid, `${user?.firstName} ${user?.lastName}`])
    );

    ticketUpdates.createdBy =
      userMap.get(ticketUpdates.createdBy) || ticketUpdates.createdBy;
    ticketUpdates.updatedBy =
      userMap.get(ticketUpdates.updatedBy) || ticketUpdates.updatedBy;

    return ticketUpdates;
  }

  public async deleteClientTicketUpdate(id: number, userId: string) {
    const clientTicketUpdate = await this.clientTicketUpdateRepo.findOne({
      where: { id },
    });
    if (!clientTicketUpdate) {
      throw CustomErrorHandler.notFound(
        `Client ticket with ID ${id} not found.`
      );
    }

    clientTicketUpdate.deletedBy = userId;
    clientTicketUpdate.deletedAt = new Date();
    await this.clientTicketUpdateRepo.save(clientTicketUpdate);

    return {
      message: `Client ticket update with ID ${id} deleted successfully.`,
    };
  }

  public async bulkUpdateClientTickets(
    ids: number[],
    updateData: Partial<ClientTicket>,
    userId: string
  ) {
    try {
      // Validate that all client tickets exist
      const existingClientTickets = await this.clientTicketRepo.find({
        where: { id: In(ids) },
      });

      if (existingClientTickets.length !== ids.length) {
        const foundIds = existingClientTickets.map((ticket) => ticket.id);
        const missingIds = ids.filter((id) => !foundIds.includes(id));
        throw CustomErrorHandler.notFound(
          `Client tickets with IDs ${missingIds.join(", ")} not found`
        );
      }

      // Update all client tickets with the provided data
      const updatePromises = existingClientTickets.map(async (clientTicket) => {
        // Only update fields that are provided in updateData
        if (updateData.status !== undefined) {
          clientTicket.status = updateData.status;

          // Handle completedOn and completedBy logic for status changes
          if (
            updateData.status === "Completed" &&
            clientTicket.status !== "Completed"
          ) {
            clientTicket.completedOn = new Date().toISOString();
            clientTicket.completedBy = userId;
          } else if (
            updateData.status !== "Completed" &&
            clientTicket.status === "Completed"
          ) {
            clientTicket.completedOn = null;
            clientTicket.completedBy = null;
          }
        }
        if (updateData.listingId !== undefined) {
          clientTicket.listingId = updateData.listingId;
        }
        if (updateData.category !== undefined) {
          clientTicket.category =
            typeof updateData.category === "string"
              ? updateData.category
              : JSON.stringify(updateData.category);
        }
        if (updateData.description !== undefined) {
          clientTicket.description = updateData.description;
        }
        if (updateData.resolution !== undefined) {
          clientTicket.resolution = updateData.resolution;
        }
        if (updateData.clientSatisfaction !== undefined) {
          clientTicket.clientSatisfaction = updateData.clientSatisfaction;
        }
        if (updateData.urgency !== undefined) {
          clientTicket.urgency = updateData.urgency;
        }

        if ((updateData as any).latestUpdates) {
          await this.saveClientTicketUpdates({
            ticketId: clientTicket.id,
            updates: (updateData as any).latestUpdates
          }, userId);
        }

        clientTicket.updatedBy = userId;
        clientTicket.updatedAt = new Date();
        return this.clientTicketRepo.save(clientTicket);
      });

      const updatedClientTickets = await Promise.all(updatePromises);

      return {
        success: true,
        updatedCount: updatedClientTickets.length,
        message: `Successfully updated ${updatedClientTickets.length} client tickets`,
      };
    } catch (error) {
      throw error;
    }
  }

  async updateAssignee(id: number, assignee: string, userId: string) {
    const clientTicket = await this.clientTicketRepo.findOne({ where: { id } });
    if (!clientTicket) {
      throw CustomErrorHandler.notFound(`clientTicket with ID ${id} not found`);
    }
    clientTicket.assignee = assignee;
    clientTicket.updatedBy = userId;
    return await this.clientTicketRepo.save(clientTicket);
  }

  async updateUrgency(id: number, urgency: number, userId: string) {
    const clientTicket = await this.clientTicketRepo.findOne({ where: { id } });
    if (!clientTicket) {
      throw CustomErrorHandler.notFound(`clientTicket with ID ${id} not found`);
    }
    clientTicket.urgency = urgency;
    clientTicket.updatedBy = userId;
    return await this.clientTicketRepo.save(clientTicket);
  }

  async updateMistake(id: number, mistake: string, userId: string) {
    const clientTicket = await this.clientTicketRepo.findOne({ where: { id } });
    if (!clientTicket) {
      throw CustomErrorHandler.notFound(`clientTicket with ID ${id} not found`);
    }
    clientTicket.mistake = mistake;
    if (mistake === "Resolved") {
      clientTicket.mistakeResolvedOn = format(new Date(), "yyyy-MM-dd");
    } else {
      clientTicket.mistakeResolvedOn = null;
    }
    clientTicket.updatedBy = userId;
    return await this.clientTicketRepo.save(clientTicket);
  }

  async exportTicketsToExcel(filters: {
    fromDate?: string;
    toDate?: string;
    status?: string[];
    listingId?: string[];
    category?: string[];
    propertyType?: string[];
    serviceType?: string[];
    keyword?: string;
    keywordField?: string;
  }): Promise<Buffer> {
    const userId = filters["userId"]; // Отримується з контролера

    const listingService = new ListingService();
    let listingIds = [];
    if (filters.propertyType?.length || filters.serviceType?.length) {
      const [propertyTypeListings, serviceTypeListings] = await Promise.all([
        filters.propertyType?.length ? listingService.getListingsByPropertyTypes(filters.propertyType, userId) : Promise.resolve([]),
        filters.serviceType?.length ? listingService.getListingsByServiceTypes(filters.serviceType, userId) : Promise.resolve([]),
      ]);
      const propertyTypeIds = propertyTypeListings.map((listing) => Number(listing.id));
      const serviceTypeIds = serviceTypeListings.map((listing) => Number(listing.id));
      listingIds = propertyTypeIds.length && serviceTypeIds.length
        ? propertyTypeIds.filter((id) => serviceTypeIds.includes(id))
        : [...propertyTypeIds, ...serviceTypeIds];
      if (!listingIds.length) listingIds = [-1];
    } else {
      listingIds = filters.listingId;
    }

    const baseWhere: any = {
      ...(filters.category &&
        filters.category.length > 0 && { category: In(filters.category) }),
      ...(listingIds && listingIds.length > 0 && { listingId: In(listingIds) }),
      ...(filters.status &&
        filters.status.length > 0 && { status: In(filters.status) }),
      ...(filters.fromDate &&
        filters.toDate && {
          createdAt: Between(
            new Date(filters.fromDate),
            new Date(new Date(filters.toDate).setHours(23, 59, 59, 999))
          ),
        }),
    };
    const keywordFields = ["description", "resolution"];
    const selectedKeywordField = keywordFields.includes(String(filters.keywordField || "")) ? String(filters.keywordField) : "all";
    const latestUpdateTicketIds = filters.keyword && (selectedKeywordField === "all" || filters.keywordField === "latestUpdate")
      ? (await this.clientTicketUpdateRepo
        .createQueryBuilder("ticketUpdate")
        .leftJoin("ticketUpdate.clientTicket", "ticket")
        .select("DISTINCT ticket.id", "id")
        .where("ticketUpdate.updates LIKE :keyword", { keyword: `%${filters.keyword}%` })
        .getRawMany()).map((row) => Number(row.id))
      : [];
    const whereClause = filters.keyword
      ? filters.keywordField === "latestUpdate"
        ? { ...baseWhere, id: In(latestUpdateTicketIds.length ? latestUpdateTicketIds : [-1]) }
        : selectedKeywordField === "all"
          ? [
            ...keywordFields.map((field) => ({ ...baseWhere, [field]: Like(`%${filters.keyword}%`) })),
            ...(latestUpdateTicketIds.length ? [{ ...baseWhere, id: In(latestUpdateTicketIds) }] : []),
          ]
          : { ...baseWhere, [selectedKeywordField]: Like(`%${filters.keyword}%`) }
      : baseWhere;

    const tickets = await this.clientTicketRepo.find({
      where: whereClause,
      relations: ["clientTicketUpdates"],
      order: { createdAt: "DESC" },
    });

    const listings = await listingService.getAllListingsForLookup();

    // Отримати імена користувачів
    const users = await this.usersRepo.find();
    const userMap = new Map(
      users.map((user) => [user.uid, `${user?.firstName} ${user?.lastName}`])
    );

    // Форматувати всі поля для експорту
    const formattedData = tickets.map((ticket) => {
      // Find latest update if any
      let latestUpdateText = "-";
      if (ticket.clientTicketUpdates && ticket.clientTicketUpdates.length > 0) {
        const latestUpdate = ticket.clientTicketUpdates.reduce((latest, current) =>
          Number(current.id) > Number(latest.id) ? current : latest
        );
        latestUpdateText = latestUpdate?.updates || "-";
      }

      // Format Client Satisfaction
      const satisfactionOptions = [
        { value: 1, label: "Very Dissatisfied" },
        { value: 2, label: "Dissatisfied" },
        { value: 3, label: "Neutral" },
        { value: 4, label: "Satisfied" },
        { value: 5, label: "Very Satisfied" },
      ];
      const satisfactionOption = satisfactionOptions.find(opt => opt.value === ticket.clientSatisfaction);
      const clientSatisfactionText = ticket.clientSatisfaction ? (satisfactionOption?.label || String(ticket.clientSatisfaction)) : "Not Rated";

      return {
        ID: ticket.id,
        Status: ticket.status || "-",
        Assignee: userMap.get(ticket.assignee) || ticket.assignee || "-",
        Property: listings.find((listing) => String(listing.id) === String(ticket.listingId))?.internalListingName || ticket.listingId || "-",
        Category: (() => {
          if (!ticket.category) return "-";
          try {
            const parsed = JSON.parse(ticket.category);
            return Array.isArray(parsed) ? parsed.join(", ") : parsed;
          } catch {
            return ticket.category;
          }
        })(),
        Description: ticket.description || "-",
        "Latest Update": latestUpdateText,
        Urgency: ticket.urgency || 0,
        "Due Date": ticket.dueDate ? format(new Date(ticket.dueDate + "T00:00:00"), "yyyy-MM-dd") : "-",
        Mistake: ticket.mistake || "-",
        "Mistake Resolved On": ticket.mistakeResolvedOn || "-",
        Resolution: ticket.resolution || "-",
        "Client Satisfaction": clientSatisfactionText,
        "Created On": ticket.createdAt ? format(new Date(ticket.createdAt), "MM-dd-yyyy hh:mm a") : "-",
        "Created By": userMap.get(ticket.createdBy) || ticket.createdBy || "-",
        "Updated On": ticket.updatedAt ? format(new Date(ticket.updatedAt), "MM-dd-yyyy hh:mm a") : "-",
        "Updated By": userMap.get(ticket.updatedBy) || ticket.updatedBy || "-",
        "Completed At": ticket.completedOn ? format(new Date(ticket.completedOn), "MM-dd-yyyy hh:mm a") : "-",
        "Completed By": userMap.get(ticket.completedBy) || ticket.completedBy || "-",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const csv = XLSX.utils.sheet_to_csv(worksheet);

    return Buffer.from(csv, "utf-8");
  }
}
