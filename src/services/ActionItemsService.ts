import { appDatabase } from "../utils/database.util";
import { ActionItems } from "../entity/ActionItems";
import { Listing } from "../entity/Listing";
import logger from "../utils/logger.utils";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { Between, Brackets, ILike, In, Like } from "typeorm";
import { start } from "repl";
import { UsersEntity } from "../entity/Users";
import { ActionItemsUpdates } from "../entity/ActionItemsUpdates";
import { ReservationInfoService } from "./ReservationInfoService";
import { ReservationService } from "./ReservationService";
import { Issue } from "../entity/Issue";
import { IssuesService } from "./IssuesService";
import { IssueUpdates } from "../entity/IsssueUpdates";
import { ListingService } from "./ListingService";
import { format } from "date-fns";
import * as XLSX from "xlsx";

interface ActionItemFilter {
  category?: string;
  page: number;
  limit: number;
  listingId?: string[];
  guestName?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  dateType?: string;
}

interface HostBuddyActionItem {
  property_name: string;
  guest_name: string;
  item: string;
  category: string;
  status: string;
}

type StayTiming = "past" | "ongoing" | "upcoming";

const DEFAULT_TIME_ZONE = "America/New_York";

const normalizeStayTiming = (value?: string): StayTiming | null => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "past" || normalized === "ongoing" || normalized === "upcoming") {
    return normalized;
  }
  if (normalized === "current") return "ongoing";
  if (normalized === "future") return "upcoming";
  return null;
};

const normalizeDateKey = (value: any): string | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
};

const normalizeHour = (value: any, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
};

const normalizeIdArray = (value: any) => {
  if (Array.isArray(value)) return value.map(Number).filter((id) => Number.isFinite(id));
  if (value === undefined || value === null || value === "") return [];
  return [Number(value)].filter((id) => Number.isFinite(id));
};

const normalizeStringArray = (value: any) => {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
};

const isValidTimeZone = (timeZone?: string | null) => {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return (localUtc - date.getTime()) / 60000;
};

const zonedLocalTimeToUtcDate = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
) => {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  const utcDate = new Date(utcGuess.getTime() - offset * 60000);
  const adjustedOffset = getTimeZoneOffsetMinutes(utcDate, timeZone);
  return new Date(utcGuess.getTime() - adjustedOffset * 60000);
};

const getStayBoundaryUtc = (dateValue: any, hourValue: any, timeZone: string, fallbackHour: number) => {
  const dateKey = normalizeDateKey(dateValue);
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const hour = normalizeHour(hourValue, fallbackHour);
  const wholeHour = Math.floor(hour);
  const minute = Math.round((hour - wholeHour) * 60);
  return zonedLocalTimeToUtcDate(year, month, day, wholeHour, minute, 0, timeZone);
};

export class ActionItemsService {
  private actionItemsRepo = appDatabase.getRepository(ActionItems);
  private listingRepo = appDatabase.getRepository(Listing);
  private reservationInfoRepo = appDatabase.getRepository(
    ReservationInfoEntity
  );
  private usersRepo = appDatabase.getRepository(UsersEntity);
  private actionItemsUpdatesRepo =
    appDatabase.getRepository(ActionItemsUpdates);
  private issueUpdatesRepo = appDatabase.getRepository(IssueUpdates);

  async createAtionItemFromHostbuddy(actionItems: HostBuddyActionItem) {
    const { property_name, guest_name, category, status, item } = actionItems;

    const listing = await this.listingRepo.findOne({
      where: { internalListingName: property_name },
      order: { id: "DESC" },
    });

    if (!listing) {
      logger.error(`Listing with name ${property_name} not found`);
    }

    const reservation = await this.reservationInfoRepo.findOne({
      where: {
        guestName: guest_name,
        listingMapId: listing ? listing.id : -1,
      },
      order: { arrivalDate: "DESC" },
    });

    if (!reservation) {
      logger.error(`Reservation for guest ${guest_name} not found`);
    }

    const actionItem = new ActionItems();
    actionItem.listingName = property_name;
    actionItem.listingId = listing
      ? listing.id
      : reservation
      ? reservation.listingMapId
      : null;
    actionItem.guestName = guest_name;
    actionItem.reservationId = reservation ? reservation.id : null;
    actionItem.item = item;
    actionItem.category = category;
    actionItem.status = status;
    actionItem.createdBy = "system";

    return await this.actionItemsRepo.save(actionItem);
  }

  async getActionItems(filter: any) {
    const {
      category,
      page = 1,
      limit = 10,
      listingId,
      guestName,
      status,
      fromDate,
      toDate,
      ids,
      reservationId,
      propertyType,
      serviceType,
      stayTiming,
      keyword,
      keywordField,
      dateType = 'CREATED',
    } = filter;

    const categoryFilters = normalizeStringArray(category);
    const statusFilters = normalizeStringArray(status);
    const propertyTypeFilters = normalizeStringArray(propertyType);
    const serviceTypeFilters = normalizeStringArray(serviceType);
    const reservationIdFilters = normalizeIdArray(reservationId);
    const idFilters = normalizeIdArray(ids);
    let listingIds = normalizeIdArray(listingId);
    const listingService = new ListingService();
    if (propertyTypeFilters.length > 0) {
      const propertyListingIds = (await listingService.getListingsByPropertyTypes(propertyTypeFilters, undefined, true)).map(
        (l) => l.id
      );
      listingIds = listingIds?.length
        ? listingIds.filter((id) => propertyListingIds.includes(Number(id)))
        : propertyListingIds;
    }

    if (serviceTypeFilters.length > 0) {
      const serviceListingIds = (await listingService.getListingsByServiceTypes(serviceTypeFilters, undefined, true)).map(
        (l) => l.id
      );
      listingIds = listingIds?.length
        ? listingIds.filter((id) => serviceListingIds.includes(Number(id)))
        : serviceListingIds;
    }

    if ((propertyTypeFilters.length > 0 || serviceTypeFilters.length > 0) && listingIds.length === 0) {
      return { actionItems: [], total: 0 };
    }

    const normalizedStayTiming = normalizeStayTiming(stayTiming);

    let dateCondition = {};
    if (fromDate && toDate) {

      if (dateType === 'CHECK_IN') {
        dateCondition = { reservation: { arrivalDate: Between(fromDate, toDate) } };
      } else if (dateType === 'CHECK_OUT') {
        dateCondition = { reservation: { departureDate: Between(fromDate, toDate) } };
      } else if (dateType === 'UPDATED') {
        dateCondition = { updatedAt: Between(`${fromDate} 00:00:00`, `${toDate} 23:59:59`) };
      } else {
        dateCondition = { createdAt: Between(`${fromDate} 00:00:00`, `${toDate} 23:59:59`) };
      }
    }

    const whereConditions: any = {
      ...(idFilters.length > 0 && { id: In(idFilters) }),
      ...(categoryFilters.length > 0 && { category: In(categoryFilters) }),
      ...(listingIds && listingIds.length > 0 && { listingId: In(listingIds) }),
      ...(reservationIdFilters.length > 0 && { reservationId: In(reservationIdFilters) }),
      ...(guestName && { guestName }),
      ...(statusFilters.length > 0 && { status: In(statusFilters) }),
      ...dateCondition,
    };

    // Prepare users list and map once
    const users = await this.usersRepo.find({
      select: ["uid", "firstName", "lastName"],
      withDeleted: true,
    });

    const userMap = new Map(
      users.map((user) => [user.uid, `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.uid])
    );

    // Prepare the assignee list once to reuse it in the mapping loop
    const globalAssigneeList = users.map((user) => {
      const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.uid;
      return { uid: user.uid, name };
    });

    // Use QueryBuilder for selective joins and efficient keyword search
    const query = this.actionItemsRepo
      .createQueryBuilder("actionItem")
      .leftJoinAndSelect("actionItem.actionItemsUpdates", "actionItemsUpdates")
      .leftJoin("actionItem.reservation", "reservation")
      .addSelect([
        "reservation.id",
        "reservation.arrivalDate",
        "reservation.departureDate",
        "reservation.checkInTime",
        "reservation.checkOutTime",
        "reservation.guestName",
        "reservation.listingName",
        "reservation.guestEmail",
        "reservation.phone",
        "reservation.source",
        "reservation.channelName",
        "reservation.reservationId",
        "reservation.channelReservationId",
        "reservation.hostawayReservationId",
      ]);

    if (keyword) {
      const selectedKeywordField = String(keywordField || "all");
      const searchableFields: Record<string, string[]> = {
        item: ["actionItem.item"],
        guestName: ["actionItem.guestName", "reservation.guestName"],
        guestContact: ["reservation.phone", "reservation.guestEmail"],
        updates: ["actionItemsUpdates.updates"],
        resolutionNotes: ["actionItem.item", "actionItemsUpdates.updates"],
        managerNotes: ["actionItem.item", "actionItemsUpdates.updates"],
        listingName: ["actionItem.listingName", "reservation.listingName"],
        category: ["actionItem.category"],
        status: ["actionItem.status"],
        assignee: ["actionItem.assignee"],
        reservation: ["actionItem.reservationId", "reservation.reservationId", "reservation.channelReservationId", "reservation.hostawayReservationId"],
        channel: ["reservation.channelName", "reservation.source"],
        createdBy: ["actionItem.createdBy"],
        updatedBy: ["actionItem.updatedBy"],
        mistake: ["actionItem.mistake"],
      };
      const defaultSearchFields = Array.from(new Set(Object.values(searchableFields).flat()));
      const fieldsToSearch = searchableFields[selectedKeywordField] || defaultSearchFields;
      query.andWhere(new Brackets(qb => {
        fieldsToSearch.forEach((field, index) => {
          const condition = `CAST(${field} AS TEXT) ILike :keyword`;
          if (index === 0) qb.where(condition, { keyword: `%${keyword}%` });
          else qb.orWhere(condition, { keyword: `%${keyword}%` });
        });
      }));

      if (Object.keys(whereConditions).length > 0) {
        query.andWhere(whereConditions);
      }
    } else {
      query.andWhere(whereConditions);
    }

    query.orderBy("actionItem.createdAt", "DESC");

    if (!normalizedStayTiming) {
      query.skip((page - 1) * limit).take(limit);
    }

    const [queriedActionItems, queriedTotal] = await query.getManyAndCount();
    let actionItems = queriedActionItems;
    let total = queriedTotal;

    if (normalizedStayTiming) {
      const listingMap = await this.getListingTimingMap(actionItems);
      const filteredActionItems = actionItems.filter((actionItem) => {
        const listing = listingMap.get(Number(actionItem.listingId));
        return this.getActionItemStayTiming(actionItem, listing) === normalizedStayTiming;
      });
      total = filteredActionItems.length;
      actionItems = filteredActionItems.slice((page - 1) * limit, page * limit);
    }

    const transformedActionItems = actionItems.map((actionItem) => {
      return {
        ...actionItem,
        createdBy: userMap.get(actionItem.createdBy) || actionItem.createdBy,
        updatedBy: userMap.get(actionItem.updatedBy) || actionItem.updatedBy,
        actionItemsUpdates: (actionItem.actionItemsUpdates || []).map((update) => ({
          ...update,
          createdBy: userMap.get(update.createdBy) || update.createdBy,
          updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
        })),
        assigneeName: userMap.get(actionItem.assignee) || actionItem.assignee,
        assigneeList: globalAssigneeList, // Reuse the same reference
      };
    });

    return { actionItems: transformedActionItems, total };
  }

  private async getListingTimingMap(actionItems: ActionItems[]) {
    const listingIds = Array.from(
      new Set(
        actionItems
          .map((actionItem) => Number(actionItem.listingId))
          .filter((id) => Number.isFinite(id))
      )
    );
    if (!listingIds.length) return new Map<number, Listing>();
    const listings = await this.listingRepo.find({
      where: { id: In(listingIds) },
      withDeleted: true,
    });
    return new Map(listings.map((listing) => [Number(listing.id), listing]));
  }

  private getActionItemStayTiming(actionItem: ActionItems, listing?: Listing): StayTiming | null {
    const reservation = (actionItem as any).reservation;
    const timeZone = isValidTimeZone(listing?.timeZoneName) ? listing!.timeZoneName : DEFAULT_TIME_ZONE;
    const checkInAt = getStayBoundaryUtc(
      reservation?.arrivalDate,
      reservation?.checkInTime ?? listing?.checkInTimeStart,
      timeZone,
      15
    );
    const checkOutAt = getStayBoundaryUtc(
      reservation?.departureDate,
      reservation?.checkOutTime ?? listing?.checkOutTime,
      timeZone,
      11
    );

    if (!checkInAt || !checkOutAt) return null;

    const now = new Date();
    if (now > checkOutAt) return "past";
    if (now >= checkInAt && now <= checkOutAt) return "ongoing";
    return "upcoming";
  }

  async createActionItem(actionItem: ActionItems, userId: string) {
    const {
      listingName,
      guestName,
      item,
      category,
      status,
      listingId,
      reservationId,
      assignee,
      urgency,
      mistake,
    } = actionItem;

    const newActionItem = new ActionItems();
    newActionItem.listingName = listingName;
    newActionItem.listingId = listingId;
    newActionItem.guestName = guestName;
    newActionItem.reservationId = reservationId;
    newActionItem.item = item;
    newActionItem.category = category;
    newActionItem.status = status;
    newActionItem.createdBy = userId;
    newActionItem.assignee = assignee || null;
    newActionItem.urgency = urgency || null;
    newActionItem.mistake = mistake || null;
    newActionItem.mistakeResolvedOn =
      mistake === "Resolved" ? format(new Date(), "yyyy-MM-dd") : null;

    return await this.actionItemsRepo.save(newActionItem);
  }

  async updateActionItem(actionItem: ActionItems, userId: string) {
    const existingActionItem = await this.actionItemsRepo.findOne({
      where: { id: actionItem.id },
    });
    if (!existingActionItem) {
      throw CustomErrorHandler.notFound(
        `Action item with ID ${actionItem.id} not found`
      );
    }

    existingActionItem.listingName = actionItem.listingName;
    existingActionItem.guestName = actionItem.guestName;
    existingActionItem.item = actionItem.item;
    existingActionItem.category = actionItem.category;
    existingActionItem.status = actionItem.status;
    existingActionItem.listingId = actionItem.listingId;
    existingActionItem.reservationId = actionItem.reservationId;
    existingActionItem.updatedBy = userId;
    existingActionItem.assignee = actionItem.assignee || null;
    existingActionItem.urgency = actionItem.urgency || null;
    existingActionItem.mistake = actionItem.mistake || null;
    existingActionItem.mistakeResolvedOn =
      actionItem.mistake === "Resolved"
        ? format(new Date(), "yyyy-MM-dd")
        : null;

    if (
      existingActionItem.status !== "completed" &&
      actionItem.status === "completed"
    ) {
      existingActionItem.completedOn = format(new Date(), "yyyy-MM-dd");
    } else {
      existingActionItem.completedOn = null;
    }

    return await this.actionItemsRepo.save(existingActionItem);
  }

  async deleteActionItem(id: number, userId: string) {
    const existingActionItem = await this.actionItemsRepo.findOne({
      where: { id },
    });
    if (!existingActionItem) {
      throw CustomErrorHandler.notFound(`Action item with ID ${id} not found`);
    }

    existingActionItem.deletedBy = userId;
    existingActionItem.deletedAt = new Date();

    return await this.actionItemsRepo.save(existingActionItem);
  }

  async createActionItemsUpdates(body: any, userId: string) {
    const { actionItemId, updates } = body;

    const actionItem = await this.actionItemsRepo.findOne({
      where: { id: actionItemId },
    });
    if (!actionItem) {
      throw CustomErrorHandler.notFound(
        `Action item with ID ${actionItemId} not found`
      );
    }

    const newUpdate = this.actionItemsUpdatesRepo.create({
      actionItems: actionItem,
      updates: updates,
      createdBy: userId,
    });

    const result = await this.actionItemsUpdatesRepo.save(newUpdate);
    const users = await this.usersRepo.find();
    const userMap = new Map(
      users.map((user) => [user.uid, `${user.firstName} ${user.lastName}`])
    );
    result.createdBy = userMap.get(result.createdBy) || result.createdBy;
    return result;
  }

  async updateActionItemsUpdates(body: any, userId: string) {
    const { id, updates } = body;

    const existingActionItemUpdate = await this.actionItemsUpdatesRepo.findOne({
      where: { id },
    });
    if (!existingActionItemUpdate) {
      throw CustomErrorHandler.notFound(
        `Action item update with ID ${id} not found`
      );
    }
    existingActionItemUpdate.updates = updates;
    existingActionItemUpdate.updatedBy = userId;

    const result = await this.actionItemsUpdatesRepo.save(
      existingActionItemUpdate
    );
    const users = await this.usersRepo.find();
    const userMap = new Map(
      users.map((user) => [user.uid, `${user.firstName} ${user.lastName}`])
    );
    result.createdBy = userMap.get(result.createdBy) || result.createdBy;
    return result;
  }

  async deleteActionItemsUpdates(id: number, userId: string) {
    const existingActionItemUpdate = await this.actionItemsUpdatesRepo.findOne({
      where: { id },
    });
    if (!existingActionItemUpdate) {
      throw CustomErrorHandler.notFound(
        `Action item update with ID ${id} not found`
      );
    }

    existingActionItemUpdate.deletedBy = userId;
    existingActionItemUpdate.deletedAt = new Date();

    return await this.actionItemsUpdatesRepo.save(existingActionItemUpdate);
  }

  async migrateActionItemsToIssues(body: any, userId: string) {
    const { id, status, category } = body;

    const actionItem = await this.actionItemsRepo.findOne({
      where: { id },
      relations: ["actionItemsUpdates"],
    });
    if (!actionItem) {
      throw CustomErrorHandler.notFound(`Action item with ID ${id} not found`);
    }

    const reservationInfoService = new ReservationInfoService();
    const reservationInfo = await reservationInfoService.getReservationById(
      actionItem.reservationId
    );
    if (!reservationInfo) {
      logger.warn(
        `[migrateActionItemsToIssues] No reservation info found for guest: ${actionItem.guestName}`
      );
      throw CustomErrorHandler.notFound(
        `Reservation info for guest ${actionItem.guestName} not found`
      );
    }

    const users = await this.usersRepo.find();
    const userMap = new Map(
      users.map((user) => [user.uid, `${user.firstName} ${user.lastName}`])
    );

    const reservationService = new ReservationService();
    const channels = await reservationService.getChannelList();
    const channel = channels.find(
      (c) => c.channelId === reservationInfo.channelId
    ).channelName;
    const creator = userMap.get(actionItem.createdBy) || actionItem.createdBy;

    const data: Partial<Issue> = {
      channel,
      listing_id: String(reservationInfo.listingMapId),
      check_in_date: reservationInfo.arrivalDate,
      reservation_amount: Number(reservationInfo.totalPrice),
      guest_name: reservationInfo.guestName,
      guest_contact_number: reservationInfo.phone,
      issue_description: `[MOVED FROM ACTION ITEM]  ${actionItem.item}`,
      creator,
      status: status,
      reservation_id: String(reservationInfo.id),
      claim_resolution_status: "N/A",
      estimated_reasonable_price: 0,
      final_price: 0,
      claim_resolution_amount: 0,
      category,
      created_by: actionItem.createdBy,
      updated_by: actionItem.updatedBy,
      created_at: actionItem.createdAt,
      updated_at: actionItem.updatedAt,
    };

    try {
      const issueService = new IssuesService();
      const issue = await issueService.createIssue(data, creator, []);

      //save the issue updates to the database if exists any
      if (actionItem.actionItemsUpdates?.length > 0) {
        const issueUpdate = actionItem.actionItemsUpdates.map((update) =>
          this.issueUpdatesRepo.create({
            updates: update.updates,
            createdBy: update.createdBy,
            issue: issue,
            updatedBy: update.updatedBy,
            createdAt: update.createdAt,
            updatedAt: update.updatedAt,
          })
        );
        await this.issueUpdatesRepo.save(issueUpdate);
      }

      await this.deleteActionItem(id, userId);
      logger.info(
        `[migrateActionItemsToIssues] Action item with ID ${id} deleted successfully after migrating to issue ${issue?.id}`
      );
      return issue;
    } catch (error) {
      logger.error(
        `[migrateActionItemsToIssues] Error creating issue: ${error.message}`
      );
    }
  }

  async updateActionItemStatus(id: number, status: string, userId: string) {
    const actionItem = await this.actionItemsRepo.findOne({ where: { id } });
    if (!actionItem) {
      logger.error(
        `[updateActionItemStatus] Action item with id ${id} not found.`
      );
      return null;
    }
    actionItem.status = status;
    actionItem.updatedBy = userId;
    return await this.actionItemsRepo.save(actionItem);
  }

  async bulkUpdateActionItems(
    ids: number[],
    updateData: Partial<ActionItems>,
    userId: string
  ) {
    try {
      // Validate that all action items exist
      const existingActionItems = await this.actionItemsRepo.find({
        where: { id: In(ids) },
      });

      if (existingActionItems.length !== ids.length) {
        const foundIds = existingActionItems.map((item) => item.id);
        const missingIds = ids.filter((id) => !foundIds.includes(id));
        throw CustomErrorHandler.notFound(
          `Action items with IDs ${missingIds.join(", ")} not found`
        );
      }

      // Update all action items with the provided data
      const updatePromises = existingActionItems.map((actionItem) => {
        // Only update fields that are provided in updateData
        if (updateData.listingName !== undefined) {
          actionItem.listingName = updateData.listingName;
        }
        if (updateData.guestName !== undefined) {
          actionItem.guestName = updateData.guestName;
        }
        if (updateData.item !== undefined) {
          actionItem.item = updateData.item;
        }
        if (updateData.category !== undefined) {
          actionItem.category = updateData.category;
        }
        if (updateData.status !== undefined) {
          actionItem.status = updateData.status;
          if (updateData.status === "completed") {
            actionItem.completedOn = format(new Date(), "yyyy-MM-dd");
          } else {
            actionItem.completedOn = null;
          }
        }
        if (updateData.listingId !== undefined) {
          actionItem.listingId = updateData.listingId;
        }
        if (updateData.reservationId !== undefined) {
          actionItem.reservationId = updateData.reservationId;
        }

        actionItem.updatedBy = userId;
        return this.actionItemsRepo.save(actionItem);
      });

      const updatedActionItems = await Promise.all(updatePromises);

      logger.info(
        `[bulkUpdateActionItems] Successfully updated ${updatedActionItems.length} action items`
      );

      return {
        success: true,
        updatedCount: updatedActionItems.length,
        message: `Successfully updated ${updatedActionItems.length} action items`,
      };
    } catch (error) {
      logger.error(
        `[bulkUpdateActionItems] Error updating action items: ${error.message}`
      );
      throw error;
    }
  }

  async updateAssignee(id: number, assignee: string, userId: string) {
    const actionItem = await this.actionItemsRepo.findOne({ where: { id } });
    if (!actionItem) {
      throw CustomErrorHandler.notFound(`actionItem with ID ${id} not found`);
    }
    actionItem.assignee = assignee;
    actionItem.updatedBy = userId;
    return await this.actionItemsRepo.save(actionItem);
  }

  async updateUrgency(id: number, urgency: number, userId: string) {
    const actionItem = await this.actionItemsRepo.findOne({ where: { id } });
    if (!actionItem) {
      throw CustomErrorHandler.notFound(`actionItem with ID ${id} not found`);
    }
    actionItem.urgency = urgency;
    actionItem.updatedBy = userId;
    return await this.actionItemsRepo.save(actionItem);
  }

  async updateMistake(id: number, mistake: string, userId: string) {
    const actionItem = await this.actionItemsRepo.findOne({ where: { id } });
    if (!actionItem) {
      throw CustomErrorHandler.notFound(`actionItem with ID ${id} not found`);
    }
    actionItem.mistake = mistake;
    if (mistake === "Resolved") {
      actionItem.mistakeResolvedOn = format(new Date(), "yyyy-MM-dd");
    } else {
      actionItem.mistakeResolvedOn = null;
    }
    actionItem.updatedBy = userId;
    return await this.actionItemsRepo.save(actionItem);
  }

  async updateStatus(id: number, status: string, userId: string) {
    const actionItem = await this.actionItemsRepo.findOne({ where: { id } });
    if (!actionItem) {
      throw CustomErrorHandler.notFound(`actionItem with ID ${id} not found`);
    }
    actionItem.status = status;
    actionItem.updatedBy = userId;
    return await this.actionItemsRepo.save(actionItem);
  }

  // У ActionItemsService
  async exportActionItemsToExcel(filters: {
    fromDate?: string;
    toDate?: string;
    status?: string[];
    listingId?: string[];
    category?: string[];
    guestName?: string;
    propertyType?: string[];
    keyword?: string;
    keywordField?: string;
    dateType?: string;
  }): Promise<Buffer> {
    const userId = filters["userId"];
    const { fromDate, toDate, dateType = 'CREATED' } = filters;

    // Побудова where clause аналогічно до getActionItems
    let listingIds = [];
    if (filters.propertyType && filters.propertyType.length > 0) {
      const listingService = new ListingService();
      listingIds = (
        await listingService.getListingsByPropertyTypes(
          filters.propertyType,
          userId
        )
      ).map((l) => l.id);
    } else {
      listingIds = filters.listingId;
    }

    let dateCondition = {};
    if (fromDate && toDate) {
      if (dateType === 'CHECK_IN') {
        dateCondition = { reservation: { arrivalDate: Between(fromDate, toDate) } };
      } else if (dateType === 'CHECK_OUT') {
        dateCondition = { reservation: { departureDate: Between(fromDate, toDate) } };
      } else if (dateType === 'UPDATED') {
        dateCondition = { updatedAt: Between(`${fromDate} 00:00:00`, `${toDate} 23:59:59`) };
      } else {
        dateCondition = { createdAt: Between(`${fromDate} 00:00:00`, `${toDate} 23:59:59`) };
      }
    }

    const whereConditions = {
      ...(filters.category &&
        filters.category.length > 0 && { category: In(filters.category) }),
      ...(listingIds && listingIds.length > 0 && { listingId: In(listingIds) }),
      ...(filters.status &&
        filters.status.length > 0 && { status: In(filters.status) }),
      ...dateCondition,
      ...(filters.guestName && { guestName: filters.guestName }),
    };

    const keywordFields = ["item", "guestName"];
    const selectedKeywordField = keywordFields.includes(String(filters.keywordField || "")) ? String(filters.keywordField) : "all";
    const where = filters.keyword
      ? selectedKeywordField === "all"
        ? keywordFields.map((field) => ({ ...whereConditions, [field]: ILike(`%${filters.keyword}%`) }))
        : { ...whereConditions, [selectedKeywordField]: ILike(`%${filters.keyword}%`) }
      : whereConditions;

    const actionItems = await this.actionItemsRepo.find({
      where,
      order: { createdAt: "DESC" },
      relations: ["reservation"],
    });

    // Отримати імена користувачів
    const users = await this.usersRepo.find();
    const userMap = new Map(
      users.map((user) => [user.uid, `${user?.firstName} ${user?.lastName}`])
    );

    // Форматувати всі поля для експорту
    const formattedData = actionItems.map((item) => ({
      ID: item.id,
      Status: item.status,
      Category: item.category,
      "Listing ID": item.listingId,
      "Listing Name": item.listingName,
      "Item/Description": item.item,
      "Guest Name": item.guestName,
      "Reservation ID": item.reservationId,
      Urgency: item.urgency,
      Mistake: item.mistake,
      "Mistake Resolved On": item.mistakeResolvedOn,
      Assignee: userMap.get(item.assignee) || item.assignee,
      "Created By": userMap.get(item.createdBy) || item.createdBy,
      "Updated By": userMap.get(item.updatedBy) || item.updatedBy,
      "Created At": item.createdAt,
      "Updated At": item.updatedAt,
      "Completed At": item.completedOn,
      "Check-In Date": item.reservation?.arrivalDate,
      "Check-Out Date": item.reservation?.departureDate,
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const csv = XLSX.utils.sheet_to_csv(worksheet);

    return Buffer.from(csv, "utf-8");
  }

  // Додати роут:
  // router.get('/export', authenticateUser, actionItemsController.exportActionItems.bind(actionItemsController));
}
