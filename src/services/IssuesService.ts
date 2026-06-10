import { appDatabase } from "../utils/database.util";
import { Issue } from "../entity/Issue";
import {
  Between,
  Not,
  LessThan,
  In,
  MoreThan,
  Like,
  Raw,
  IsNull,
} from "typeorm";
import * as XLSX from "xlsx";
import { sendUnresolvedIssuesEmail } from "./IssuesEmailService";
import { Listing } from "../entity/Listing";
import CustomErrorHandler from "../middleware/customError.middleware";
import { ActionItems } from "../entity/ActionItems";
import { IssueUpdates } from "../entity/IsssueUpdates";
import { UsersEntity } from "../entity/Users";
import { ListingService } from "./ListingService";
import { ReservationInfoService } from "./ReservationInfoService";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { ActionItemsUpdates } from "../entity/ActionItemsUpdates";
import { FileInfo } from "../entity/FileInfo";
import path from "path";
import logger from "../utils/logger.utils";
import { format } from "date-fns";
import axios from "axios";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import OpenAI from "openai";
import { Employee } from "../entity/Employee";
import updateSlackMessage from "../utils/updateSlackMsg";
import { buildIssueUpdateMessage, formatSecureStayMarkdownForSlack } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import { uploadFileToSlack } from "../utils/uploadFileToSlack";
import { OpenPhoneService } from "./OpenPhoneService";

// Module-level cache for the user directory (users + employees + avatars).
// Avoids 3 DB queries per request; invalidates automatically after 2 minutes.
let _userDirectoryCache: { data: any[]; expiresAt: number } | null = null;

export class IssuesService {
  private issueRepo = appDatabase.getRepository(Issue);
  private actionItemRepo = appDatabase.getRepository(ActionItems);
  private actionItemUpdatesRepo = appDatabase.getRepository(ActionItemsUpdates);
  private issueUpdatesRepo = appDatabase.getRepository(IssueUpdates);
  private usersRepo = appDatabase.getRepository(UsersEntity);
  private fileInfoRepo = appDatabase.getRepository(FileInfo);
  private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
  private employeeRepo = appDatabase.getRepository(Employee);
  private openai: OpenAI | null = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

  private buildIssueCalendarDateFilter(fromDate?: string, toDate?: string) {
    if (fromDate && toDate) {
      return Raw(
        (alias) => `DATE(${alias}) BETWEEN :fromDate AND :toDate`,
        { fromDate, toDate }
      );
    }
    if (fromDate) {
      return Raw((alias) => `DATE(${alias}) >= :fromDate`, { fromDate });
    }
    if (toDate) {
      return Raw((alias) => `DATE(${alias}) <= :toDate`, { toDate });
    }
    return undefined;
  }

  private parseSlackThreadLink(slackLink: string): { channel: string; threadTs: string; messageTs: string; url: string } {
    const trimmedLink = String(slackLink || "").trim();
    if (!trimmedLink) {
      throw CustomErrorHandler.validationError("Slack thread link is required");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedLink);
    } catch {
      throw CustomErrorHandler.validationError("Please enter a valid Slack thread link");
    }

    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    const archiveIndex = pathParts.indexOf("archives");
    const channel = parsedUrl.searchParams.get("cid") || (archiveIndex >= 0 ? pathParts[archiveIndex + 1] : "");
    const permalinkPart = pathParts.find((part) => /^p\d{10,}$/.test(part));
    const messageTs = this.slackPermalinkTsToMessageTs(permalinkPart || "");
    const threadTs = parsedUrl.searchParams.get("thread_ts") || messageTs;

    if (!channel || !/^[CGD][A-Z0-9]+$/.test(channel)) {
      throw CustomErrorHandler.validationError("Slack link must include a channel ID. Please use a Slack permalink from the thread.");
    }
    if (!threadTs) {
      throw CustomErrorHandler.validationError("Slack link must include a message timestamp");
    }

    return {
      channel,
      threadTs,
      messageTs: messageTs || threadTs,
      url: parsedUrl.toString(),
    };
  }

  private slackPermalinkTsToMessageTs(value: string): string {
    const digits = String(value || "").replace(/^p/, "");
    if (!digits || digits.length < 11) return "";
    return `${digits.slice(0, -6)}.${digits.slice(-6)}`;
  }

  private async getSlackThreadPermalink(channel: string, threadTs: string): Promise<string | null> {
    try {
      const permalinkResponse = await axios.get("https://slack.com/api/chat.getPermalink", {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        },
        params: {
          channel,
          message_ts: threadTs,
        },
      });
      if (permalinkResponse.data?.ok) {
        return permalinkResponse.data?.permalink || null;
      }
      logger.warn(`[IssuesService][getSlackThreadPermalink] Slack API error: ${permalinkResponse.data?.error}`);
      return null;
    } catch (error) {
      logger.warn(`[IssuesService][getSlackThreadPermalink] Failed to fetch Slack permalink: ${error}`);
      return null;
    }
  }

  private async getSlackThreadEntries(channel: string, threadTs: string, includeRoot = false, includeBotMessages = false) {
    const response = await axios.get("https://slack.com/api/conversations.replies", {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      params: {
        channel,
        ts: threadTs,
        limit: 100,
      },
    });

    if (!response.data.ok) {
      throw new Error(response.data.error || "Slack API error");
    }

    const userCache = new Map<string, { name: string; avatar: string | null }>();
    const messages = response.data.messages || [];
    const replies = (includeRoot ? messages : messages.slice(1)).filter((message: any) => {
      if (includeBotMessages) return message.subtype !== "message_deleted";
      return !(message.bot_id || message.subtype === "bot_message");
    });

    return Promise.all(
      replies.map(async (message: any) => {
        let createdBy = "Slack User";
        let userAvatar: string | null = null;
        let source = "slack";
        let updates = message.text || "";

        if (message.bot_id || message.subtype === "bot_message") {
          createdBy = message.username || "SecureStay";
          const secureStayReplyMatch = updates.match(/^\*([^*]+?)(?: \(via SecureStay\))?:\*\n?([\s\S]*)$/);
          if (secureStayReplyMatch) {
            source = "securestay";
            createdBy = secureStayReplyMatch[1].trim() || createdBy;
            updates = secureStayReplyMatch[2].trim();
          } else if (createdBy === "SecureStay") {
            source = "securestay";
          }
        } else if (message.user) {
          if (userCache.has(message.user)) {
            const cached = userCache.get(message.user)!;
            createdBy = cached.name;
            userAvatar = cached.avatar;
          } else {
            try {
              const userResponse = await axios.get("https://slack.com/api/users.info", {
                headers: {
                  Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                },
                params: { user: message.user },
              });

              if (userResponse.data.ok && userResponse.data.user) {
                const profile = userResponse.data.user.profile || {};
                createdBy =
                  profile.display_name ||
                  profile.real_name ||
                  userResponse.data.user.name ||
                  createdBy;
                userAvatar = profile.image_48 || null;
              }
            } catch (error) {
              logger.warn(`[IssuesService][getSlackThreadEntries] Failed to fetch Slack user ${message.user}: ${error}`);
            }

            userCache.set(message.user, {
              name: createdBy,
              avatar: userAvatar,
            });
          }
        }

        return {
          id: `vendor_slack_${message.ts}`,
          source,
          createdByUid: message.user || null,
          createdByDepartment: null,
          createdAt: new Date(parseFloat(message.ts) * 1000).toISOString(),
          createdBy,
          updatedAt: null,
          updatedBy: null,
          updates,
          deletedAt: null,
          deletedBy: null,
          userAvatar,
          slackMessageTs: message.ts,
          fileInfo: Array.isArray(message.files)
            ? message.files.map((file: any, index: number) => this.buildSlackFileAttachment(file, message.ts, index))
            : [],
        };
      })
    );
  }

  private parseOpenPhoneConversationLink(openPhoneLink?: string | null) {
    const trimmedLink = String(openPhoneLink || "").trim();
    if (!trimmedLink) return null;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedLink);
    } catch {
      throw CustomErrorHandler.validationError("Please enter a valid OpenPhone or Quo conversation link");
    }

    const quoMatch = parsedUrl.pathname.match(/\/inbox\/([^/]+)\/c\/([^/]+)/i);
    if (parsedUrl.hostname.toLowerCase().includes("quo.com") && quoMatch) {
      return {
        url: parsedUrl.toString(),
        phoneNumberId: decodeURIComponent(quoMatch[1]),
        conversationId: decodeURIComponent(quoMatch[2]),
        source: "manual",
      };
    }

    if (parsedUrl.hostname.toLowerCase().includes("openphone")) {
      return {
        url: parsedUrl.toString(),
        phoneNumberId: null,
        conversationId: null,
        source: "manual",
      };
    }

    throw CustomErrorHandler.validationError("Please enter a valid OpenPhone or Quo conversation link");
  }

  private async getMainIssueSlackThread(issueId: number) {
    return this.slackMessageRepo.findOne({
      where: {
        entityType: "issues",
        entityId: issueId,
      },
      order: {
        createdAt: "DESC",
      },
    });
  }

  private getSlackFileUrl(file: any, preferPreview = false) {
    const previewUrl =
      file?.thumb_1024 ||
      file?.thumb_720 ||
      file?.thumb_480 ||
      file?.thumb_360 ||
      file?.thumb_pdf ||
      null;
    const downloadUrl = file?.url_private_download || file?.url_private || file?.permalink_public || file?.permalink || null;
    return preferPreview ? (previewUrl || downloadUrl) : (downloadUrl || previewUrl);
  }

  private buildSlackFileAttachment(file: any, messageTs: string, index: number) {
    const originalUrl = this.getSlackFileUrl(file);
    const previewUrl = this.getSlackFileUrl(file, true);
    const proxyUrl = originalUrl ? `/issues/slack-file?url=${encodeURIComponent(originalUrl)}` : null;
    const previewProxyUrl = previewUrl ? `/issues/slack-file?url=${encodeURIComponent(previewUrl)}` : proxyUrl;

    return {
      id: file?.id || `${messageTs}-${index}`,
      fileName: file?.name || `Slack file ${index + 1}`,
      originalName: file?.title || file?.name || `Slack file ${index + 1}`,
      mimeType: file?.mimetype || file?.filetype || "",
      url: previewProxyUrl,
      webViewLink: file?.permalink_public || file?.permalink || proxyUrl,
      webContentLink: proxyUrl,
      link: proxyUrl || file?.permalink_public || file?.permalink || null,
    };
  }

  async proxySlackFile(fileUrl: string) {
    const trimmedUrl = String(fileUrl || "").trim();
    if (!trimmedUrl) {
      throw CustomErrorHandler.validationError("Slack file URL is required");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      throw CustomErrorHandler.validationError("Please enter a valid Slack file URL");
    }

    if (!parsedUrl.hostname.endsWith("slack.com")) {
      throw CustomErrorHandler.validationError("Only Slack file URLs can be previewed");
    }

    return axios.get(trimmedUrl, {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      responseType: "stream",
    });
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private extractPropertyTypeTag(tags?: string | null): string | null {
    return ListingService.extractPropertyTypeFromTags(tags);
  }

  private extractServiceTypeTag(tags?: string | null): string | null {
    return ListingService.extractServiceTypeFromTags(tags);
  }

  private normalizeCategory(category?: string | null): string {
    return String(category || "Issue")
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private normalizeIssueUpdateIds(issueId: any): number[] {
    const rawValues = Array.isArray(issueId) ? issueId : [issueId];
    const ids = Array.from(
      new Set(
        rawValues
          .flatMap((value) => String(value ?? "").split(","))
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      )
    );

    if (!ids.length) {
      throw CustomErrorHandler.validationError("A valid issueId is required");
    }

    return ids;
  }

  private async getTrackedIssueUpdateSlackMessage(issueUpdate: IssueUpdates) {
    const trackedSlackUpdate = await this.slackMessageRepo.findOne({
      where: {
        entityType: "issue-updates",
        entityId: Number(issueUpdate.id),
      },
      order: {
        createdAt: "DESC",
      },
    });

    if (trackedSlackUpdate) return trackedSlackUpdate;

    if (!issueUpdate.slackMessageTs || !issueUpdate.issue?.id) return null;

    const mainIssueThread = await this.getMainIssueSlackThread(Number(issueUpdate.issue.id));
    if (!mainIssueThread) return null;

    return {
      ...mainIssueThread,
      messageTs: issueUpdate.slackMessageTs,
      threadTs: mainIssueThread.threadTs || mainIssueThread.messageTs,
    } as SlackMessageEntity;
  }

  private async postIssueUpdateToSlackThread(issueUpdate: IssueUpdates, issue: Issue, userId: string) {
    if (issueUpdate.source !== "securestay") return issueUpdate;

    const mainIssueThread = await this.getMainIssueSlackThread(Number(issue.id));
    if (!mainIssueThread) return issueUpdate;

    try {
      const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
      const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";
      const listingInfo = await appDatabase.getRepository(Listing).findOne({
        where: {
          id: Number(issue.listing_id),
        },
      });
      const slackMessage = buildIssueUpdateMessage(issueUpdate, listingInfo?.internalListingName, user);
      const payload = {
        ...slackMessage,
        channel: mainIssueThread.channel,
      };
      const slackResponse = await sendSlackMessage(payload, mainIssueThread.threadTs || mainIssueThread.messageTs);

      if (!slackResponse?.ok || !slackResponse.ts) {
        logger.warn(`Slack issue update post failed for update ${issueUpdate.id}: ${slackResponse?.error || "unknown_error"}`);
        return issueUpdate;
      }

      issueUpdate.slackMessageTs = slackResponse.ts;
      const savedUpdate = await this.issueUpdatesRepo.save(issueUpdate);

      // Upload any locally stored file attachments into the Slack thread
      try {
        const attachedFiles = await this.fileInfoRepo.find({
          where: { entityType: "issue-updates", entityId: Number(issueUpdate.id) },
        });
        const localFiles = attachedFiles.filter((f) => f.localPath && f.fileName);
        if (localFiles.length > 0) {
          await uploadFileToSlack(
            mainIssueThread.channel,
            localFiles.map((f) => f.fileName),
            "issues",
            slackResponse.ts
          );
        }
      } catch (uploadError) {
        logger.warn(`Failed to upload attachments to Slack for issue update ${issueUpdate.id}`, uploadError);
      }

      const trackedSlackUpdate = this.slackMessageRepo.create({
        channel: mainIssueThread.channel,
        messageTs: slackResponse.ts,
        threadTs: mainIssueThread.threadTs || mainIssueThread.messageTs,
        entityType: "issue-updates",
        entityId: Number(savedUpdate.id),
        originalMessage: JSON.stringify(payload),
      });
      await this.slackMessageRepo.save(trackedSlackUpdate);

      return savedUpdate;
    } catch (error) {
      logger.error(`Slack issue update post failed for update ${issueUpdate.id}`, error);
      return issueUpdate;
    }
  }

  private async deleteTrackedIssueUpdateSlackMessage(issueUpdate: IssueUpdates) {
    const trackedSlackUpdate = await this.getTrackedIssueUpdateSlackMessage(issueUpdate);

    if (!trackedSlackUpdate) return;

    if (!process.env.SLACK_BOT_TOKEN) {
      throw CustomErrorHandler.validationError("SLACK_BOT_TOKEN is not configured.");
    }

    try {
      const response = await axios.post(
        "https://slack.com/api/chat.delete",
        {
          channel: trackedSlackUpdate.channel,
          ts: trackedSlackUpdate.messageTs,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          },
        }
      );

      if (!response.data?.ok && !["message_not_found", "message_deleted"].includes(response.data?.error)) {
        throw new Error(response.data?.error || "unknown_error");
      }

      if (trackedSlackUpdate.entityType === "issue-updates") {
        await this.slackMessageRepo.remove(trackedSlackUpdate);
      }
    } catch (error: any) {
      logger.error(`Slack issue update delete failed for update ${issueUpdate.id}`, error);
      throw CustomErrorHandler.validationError(`Slack delete failed: ${error?.message || "unknown_error"}`);
    }
  }

  private buildEmployeePhotoUrl(fileInfo?: FileInfo | null) {
    if (!fileInfo) return null;

    if (fileInfo.status === "uploaded" && fileInfo.driveFileId) {
      return `${process.env.BASE_URL}/getdriveimage/${fileInfo.driveFileId}`;
    }

    if (fileInfo.localPath && fileInfo.fileName) {
      return `${process.env.BASE_URL}/getimage/employees/${fileInfo.fileName}`;
    }

    return null;
  }

  private async buildIssueUserDirectory() {
    const now = Date.now();
    if (_userDirectoryCache && now < _userDirectoryCache.expiresAt) {
      return _userDirectoryCache.data;
    }

    const users = await this.usersRepo.find();
    const employees = await this.employeeRepo.find({
      where: { deletedAt: null as any },
      select: ["userId", "profilePhoto", "preferredName", "department"],
    });

    const profilePhotoIds = employees
      .map((employee) => Number(employee.profilePhoto))
      .filter((value) => Number.isFinite(value) && value > 0);
    const photoInfoList = profilePhotoIds.length
      ? await this.fileInfoRepo.find({ where: { id: In(profilePhotoIds) } })
      : [];
    const photoInfoMap = new Map(photoInfoList.map((file) => [Number(file.id), file]));
    const employeeMap = new Map(
      employees.map((employee) => {
        const photoInfo = photoInfoMap.get(Number(employee.profilePhoto));
        return [
          employee.userId,
          {
            preferredName: employee.preferredName || null,
            department: employee.department || null,
            avatarUrl: this.buildEmployeePhotoUrl(photoInfo),
          },
        ];
      })
    );

    const result = users.map((user) => {
      const employee = employeeMap.get(user.id);
      const firstName = String(user.firstName || "").trim();
      const lastName = String(user.lastName || "").trim();
      const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
      return {
        uid: user.uid,
        name: employee?.preferredName || fullName || user.uid,
        preferredDisplayName: employee?.preferredName || firstName || fullName || user.uid,
        email: String(user.email || "").trim().toLowerCase() || null,
        department: employee?.department || user.department || null,
        avatarUrl: employee?.avatarUrl || null,
      };
    });

    _userDirectoryCache = { data: result, expiresAt: now + 2 * 60 * 1000 };
    return result;
  }

  private async resolveKeywordIssueIds(keyword: string, keywordField: string = "all"): Promise<number[]> {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) return [];

    const keywordParam = `%${normalizedKeyword}%`;
    const selectedKeywordField = [
      "description",
      "guestName",
      "guestContact",
      "property",
      "issueNotes",
      "latestUpdate",
      "resolutionNotes",
      "managerNotes",
    ].includes(String(keywordField || ""))
      ? String(keywordField)
      : "all";
    const listingRepo = appDatabase.getRepository(Listing);
    const reservationRepo = appDatabase.getRepository(ReservationInfoEntity);

    const shouldSearchProperty = selectedKeywordField === "all" || selectedKeywordField === "property";
    const shouldSearchGuestName = selectedKeywordField === "all" || selectedKeywordField === "guestName";
    const shouldSearchGuestContact = selectedKeywordField === "all" || selectedKeywordField === "guestContact";
    const shouldSearchLatestUpdate = selectedKeywordField === "all" || selectedKeywordField === "latestUpdate";

    const matchingListingIds = shouldSearchProperty
      ? (await listingRepo
          .createQueryBuilder("listing")
          .select("listing.id", "id")
          .where("listing.name LIKE :keyword", { keyword: keywordParam })
          .orWhere("listing.internalListingName LIKE :keyword", { keyword: keywordParam })
          .orWhere("listing.externalListingName LIKE :keyword", { keyword: keywordParam })
          .orWhere("listing.address LIKE :keyword", { keyword: keywordParam })
          .getRawMany<{ id: number }>())
          .map((listing) => Number(listing.id))
          .filter((id) => Number.isFinite(id))
      : [];

    const reservationQuery = reservationRepo
      .createQueryBuilder("reservation")
      .select("reservation.id", "id");
    let hasReservationKeywordCondition = false;
    if (shouldSearchGuestName) {
      reservationQuery.where("reservation.guestName LIKE :keyword", { keyword: keywordParam })
        .orWhere("reservation.guestFirstName LIKE :keyword", { keyword: keywordParam })
        .orWhere("reservation.guestLastName LIKE :keyword", { keyword: keywordParam });
      hasReservationKeywordCondition = true;
    }
    if (shouldSearchProperty) {
      if (hasReservationKeywordCondition) {
        reservationQuery.orWhere("reservation.listingName LIKE :keyword", { keyword: keywordParam });
      } else {
        reservationQuery.where("reservation.listingName LIKE :keyword", { keyword: keywordParam });
      }
      hasReservationKeywordCondition = true;
    }
    if (selectedKeywordField === "all") {
      reservationQuery
        .orWhere("reservation.channelName LIKE :keyword", { keyword: keywordParam })
        .orWhere("reservation.reservationId LIKE :keyword", { keyword: keywordParam });
      hasReservationKeywordCondition = true;
    }
    if (shouldSearchGuestContact) {
      if (hasReservationKeywordCondition) {
        reservationQuery.orWhere("reservation.phone LIKE :keyword", { keyword: keywordParam });
      } else {
        reservationQuery.where("reservation.phone LIKE :keyword", { keyword: keywordParam });
      }
      hasReservationKeywordCondition = true;
    }

    const matchingReservationIds = hasReservationKeywordCondition
      ? (await reservationQuery.getRawMany<{ id: number }>())
          .map((reservation) => Number(reservation.id))
          .filter((id) => Number.isFinite(id))
      : [];

    const directIssueQuery = this.issueRepo
      .createQueryBuilder("issue")
      .select("issue.id", "id");
    let hasDirectIssueCondition = false;
    const addDirectIssueCondition = (condition: string) => {
      if (hasDirectIssueCondition) {
        directIssueQuery.orWhere(condition, { keyword: keywordParam });
      } else {
        directIssueQuery.where(condition, { keyword: keywordParam });
        hasDirectIssueCondition = true;
      }
    };

    if (selectedKeywordField === "all" || selectedKeywordField === "description") addDirectIssueCondition("issue.issue_description LIKE :keyword");
    if (shouldSearchGuestName) addDirectIssueCondition("issue.guest_name LIKE :keyword");
    if (shouldSearchGuestContact) addDirectIssueCondition("issue.guest_contact_number LIKE :keyword");
    if (shouldSearchProperty) addDirectIssueCondition("issue.listing_name LIKE :keyword");
    if (selectedKeywordField === "all") {
      addDirectIssueCondition("issue.channel LIKE :keyword");
      addDirectIssueCondition("issue.category LIKE :keyword");
    }
    if (selectedKeywordField === "all" || selectedKeywordField === "issueNotes") addDirectIssueCondition("issue.owner_notes LIKE :keyword");
    if (selectedKeywordField === "all" || selectedKeywordField === "resolutionNotes") addDirectIssueCondition("issue.resolution LIKE :keyword");
    if (selectedKeywordField === "all" || selectedKeywordField === "managerNotes") addDirectIssueCondition("issue.manager_feedback LIKE :keyword");

    if (matchingListingIds.length > 0) {
      if (hasDirectIssueCondition) {
        directIssueQuery.orWhere("issue.listing_id IN (:...matchingListingIds)", { matchingListingIds });
      } else {
        directIssueQuery.where("issue.listing_id IN (:...matchingListingIds)", { matchingListingIds });
      }
      hasDirectIssueCondition = true;
    }

    if (matchingReservationIds.length > 0) {
      if (hasDirectIssueCondition) {
        directIssueQuery.orWhere("issue.reservation_id IN (:...matchingReservationIds)", { matchingReservationIds });
      } else {
        directIssueQuery.where("issue.reservation_id IN (:...matchingReservationIds)", { matchingReservationIds });
      }
      hasDirectIssueCondition = true;
    }

    const directIssueRows = hasDirectIssueCondition ? await directIssueQuery.getRawMany<{ id: number }>() : [];

    const updateIssueRows = shouldSearchLatestUpdate
      ? await this.issueUpdatesRepo
          .createQueryBuilder("issueUpdate")
          .innerJoin("issueUpdate.issue", "issue")
          .select("issue.id", "id")
          .distinct(true)
          .where("issueUpdate.deletedAt IS NULL")
          .andWhere("issueUpdate.updates LIKE :keyword", { keyword: keywordParam })
          .getRawMany<{ id: number }>()
      : [];

    return Array.from(
      new Set(
        [...directIssueRows, ...updateIssueRows]
          .map((row) => Number(row.id))
          .filter((id) => Number.isFinite(id))
      )
    );
  }

  private async resolveActivityKeywordIssueIds(keyword: string): Promise<number[]> {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) return [];

    const rows = await this.issueUpdatesRepo
      .createQueryBuilder("issueUpdate")
      .innerJoin("issueUpdate.issue", "issue")
      .select("issue.id", "id")
      .distinct(true)
      .where("issueUpdate.deletedAt IS NULL")
      .andWhere("COALESCE(issueUpdate.source, 'securestay') <> 'system'")
      .andWhere("issueUpdate.updates LIKE :keyword", { keyword: `%${normalizedKeyword}%` })
      .getRawMany<{ id: number }>();

    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveActivityTimelineUserIssueIds(userIds: string[]): Promise<number[]> {
    const normalizedUserIds = userIds.map((value) => String(value || "").trim()).filter(Boolean);
    if (normalizedUserIds.length === 0) return [];

    const rows = await this.issueUpdatesRepo
      .createQueryBuilder("issueUpdate")
      .innerJoin("issueUpdate.issue", "issue")
      .select("issue.id", "id")
      .distinct(true)
      .where("issueUpdate.deletedAt IS NULL")
      .andWhere("COALESCE(issueUpdate.source, 'securestay') <> 'system'")
      .andWhere("issueUpdate.createdBy IN (:...userIds)", {
        userIds: normalizedUserIds,
      })
      .getRawMany<{ id: number }>();

    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveActivityTimelineUserDateIssueIds(userIds: string[], fromDate?: string, toDate?: string): Promise<number[]> {
    const normalizedUserIds = userIds.map((value) => String(value || "").trim()).filter(Boolean);
    if (normalizedUserIds.length === 0 || (!fromDate && !toDate)) return [];

    const qb = this.issueUpdatesRepo
      .createQueryBuilder("issueUpdate")
      .innerJoin("issueUpdate.issue", "issue")
      .select("issue.id", "id")
      .distinct(true)
      .where("issueUpdate.deletedAt IS NULL")
      .andWhere("COALESCE(issueUpdate.source, 'securestay') <> 'system'")
      .andWhere("issueUpdate.createdBy IN (:...userIds)", {
        userIds: normalizedUserIds,
      });

    if (fromDate && toDate) {
      qb.andWhere("DATE(issueUpdate.createdAt) BETWEEN :fromDate AND :toDate", { fromDate, toDate });
    } else if (fromDate) {
      qb.andWhere("DATE(issueUpdate.createdAt) >= :fromDate", { fromDate });
    } else if (toDate) {
      qb.andWhere("DATE(issueUpdate.createdAt) <= :toDate", { toDate });
    }

    const rows = await qb.getRawMany<{ id: number }>();
    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveIssueRowDateIssueIds(column: "created_at" | "updated_at" | "completed_at" | "gr_completed_at", fromDate?: string, toDate?: string): Promise<number[]> {
    const qb = this.issueRepo
      .createQueryBuilder("issue")
      .select("issue.id", "id")
      .distinct(true)
      .where(`issue.${column} IS NOT NULL`);

    if (fromDate && toDate) {
      qb.andWhere(`DATE(issue.${column}) BETWEEN :fromDate AND :toDate`, { fromDate, toDate });
    } else if (fromDate) {
      qb.andWhere(`DATE(issue.${column}) >= :fromDate`, { fromDate });
    } else if (toDate) {
      qb.andWhere(`DATE(issue.${column}) <= :toDate`, { toDate });
    }

    const rows = await qb.getRawMany<{ id: number }>();
    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveIssueRowUserDateIssueIds(userIds: string[], column: "created_by" | "updated_by" | "completed_by" | "gr_completed_by", dateColumn: "created_at" | "updated_at" | "completed_at" | "gr_completed_at", fromDate?: string, toDate?: string): Promise<number[]> {
    const normalizedUserIds = userIds.map((value) => String(value || "").trim()).filter(Boolean);
    if (normalizedUserIds.length === 0 || (!fromDate && !toDate)) return [];

    const qb = this.issueRepo
      .createQueryBuilder("issue")
      .select("issue.id", "id")
      .distinct(true)
      .where(`issue.${column} IN (:...userIds)`, { userIds: normalizedUserIds })
      .andWhere(`issue.${dateColumn} IS NOT NULL`);

    if (fromDate && toDate) {
      qb.andWhere(`DATE(issue.${dateColumn}) BETWEEN :fromDate AND :toDate`, { fromDate, toDate });
    } else if (fromDate) {
      qb.andWhere(`DATE(issue.${dateColumn}) >= :fromDate`, { fromDate });
    } else if (toDate) {
      qb.andWhere(`DATE(issue.${dateColumn}) <= :toDate`, { toDate });
    }

    const rows = await qb.getRawMany<{ id: number }>();
    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveUpdatedEventDateIssueIds(fromDate?: string, toDate?: string, updateSource = "all"): Promise<number[]> {
    const [ticketIssueIds, timelineIssueIds] = await Promise.all([
      updateSource === "timeline" ? Promise.resolve([]) : this.resolveIssueRowDateIssueIds("updated_at", fromDate, toDate),
      updateSource === "ticket" ? Promise.resolve([]) : this.resolveActivityTimelineDateIssueIds(fromDate, toDate),
    ]);
    return Array.from(new Set([...ticketIssueIds, ...timelineIssueIds]));
  }

  private async resolveUpdatedEventUserIssueIds(userIds: string[], updateSource = "all"): Promise<number[]> {
    const [ticketIssueIds, timelineIssueIds] = await Promise.all([
      updateSource === "timeline" ? Promise.resolve([]) : this.resolveIssueRowUserIssueIds(userIds, ["updated_by"]),
      updateSource === "ticket" ? Promise.resolve([]) : this.resolveActivityTimelineUserIssueIds(userIds),
    ]);
    return Array.from(new Set([...ticketIssueIds, ...timelineIssueIds]));
  }

  private async resolveUpdatedEventUserDateIssueIds(userIds: string[], fromDate?: string, toDate?: string, updateSource = "all"): Promise<number[]> {
    const [ticketIssueIds, timelineIssueIds] = await Promise.all([
      updateSource === "timeline" ? Promise.resolve([]) : this.resolveIssueRowUserDateIssueIds(userIds, "updated_by", "updated_at", fromDate, toDate),
      updateSource === "ticket" ? Promise.resolve([]) : this.resolveActivityTimelineUserDateIssueIds(userIds, fromDate, toDate),
    ]);
    return Array.from(new Set([...ticketIssueIds, ...timelineIssueIds]));
  }

  private async resolveActivityEventDateIssueIds(activityType: string, fromDate?: string, toDate?: string, updateSource = "all"): Promise<number[]> {
    const normalizedType = activityType || "all";
    if (normalizedType === "created") return this.resolveIssueRowDateIssueIds("created_at", fromDate, toDate);
    if (normalizedType === "updated") return this.resolveUpdatedEventDateIssueIds(fromDate, toDate, updateSource);
    if (normalizedType === "last_updated") return this.resolveLastUpdatedEventIssueIds(fromDate, toDate, undefined, updateSource);
    if (normalizedType === "completed") return this.resolveIssueRowDateIssueIds("completed_at", fromDate, toDate);
    if (normalizedType === "gr_completed") return this.resolveIssueRowDateIssueIds("gr_completed_at", fromDate, toDate);

    const [createdIssueIds, updatedIssueIds, completedIssueIds, grCompletedIssueIds] = await Promise.all([
      this.resolveIssueRowDateIssueIds("created_at", fromDate, toDate),
      this.resolveUpdatedEventDateIssueIds(fromDate, toDate, updateSource),
      this.resolveIssueRowDateIssueIds("completed_at", fromDate, toDate),
      this.resolveIssueRowDateIssueIds("gr_completed_at", fromDate, toDate),
    ]);
    return Array.from(new Set([...createdIssueIds, ...updatedIssueIds, ...completedIssueIds, ...grCompletedIssueIds]));
  }

  private async resolveActivityEventUserDateIssueIds(activityType: string, userIds: string[], fromDate?: string, toDate?: string, updateSource = "all"): Promise<number[]> {
    const normalizedType = activityType || "all";
    if (normalizedType === "created") return this.resolveIssueRowUserDateIssueIds(userIds, "created_by", "created_at", fromDate, toDate);
    if (normalizedType === "updated") return this.resolveUpdatedEventUserDateIssueIds(userIds, fromDate, toDate, updateSource);
    if (normalizedType === "last_updated") return this.resolveLastUpdatedEventIssueIds(fromDate, toDate, userIds, updateSource);
    if (normalizedType === "completed") return this.resolveIssueRowUserDateIssueIds(userIds, "completed_by", "completed_at", fromDate, toDate);
    if (normalizedType === "gr_completed") return this.resolveIssueRowUserDateIssueIds(userIds, "gr_completed_by", "gr_completed_at", fromDate, toDate);

    const [createdIssueIds, updatedIssueIds, completedIssueIds, grCompletedIssueIds] = await Promise.all([
      this.resolveIssueRowUserDateIssueIds(userIds, "created_by", "created_at", fromDate, toDate),
      this.resolveUpdatedEventUserDateIssueIds(userIds, fromDate, toDate, updateSource),
      this.resolveIssueRowUserDateIssueIds(userIds, "completed_by", "completed_at", fromDate, toDate),
      this.resolveIssueRowUserDateIssueIds(userIds, "gr_completed_by", "gr_completed_at", fromDate, toDate),
    ]);
    return Array.from(new Set([...createdIssueIds, ...updatedIssueIds, ...completedIssueIds, ...grCompletedIssueIds]));
  }

  private async resolveIssueRowUserIssueIds(userIds: string[], columns: Array<"created_by" | "updated_by" | "completed_by" | "gr_completed_by">): Promise<number[]> {
    const normalizedUserIds = userIds.map((value) => String(value || "").trim()).filter(Boolean);
    if (normalizedUserIds.length === 0 || columns.length === 0) return [];

    const qb = this.issueRepo
      .createQueryBuilder("issue")
      .select("issue.id", "id")
      .distinct(true);

    columns.forEach((column, index) => {
      const clause = `issue.${column} IN (:...userIds)`;
      if (index === 0) qb.where(clause, { userIds: normalizedUserIds });
      else qb.orWhere(clause, { userIds: normalizedUserIds });
    });

    const rows = await qb.getRawMany<{ id: number }>();
    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveActivityUserIssueIds(activityType: string, userIds: string[], updateSource = "all"): Promise<number[]> {
    const normalizedType = activityType || "all";
    const normalizedUserIds = userIds.map((value) => String(value || "").trim()).filter(Boolean);
    if (normalizedUserIds.length === 0) return [];

    if (normalizedType === "updated") {
      return this.resolveUpdatedEventUserIssueIds(normalizedUserIds, updateSource);
    }

    if (normalizedType === "last_updated") {
      return this.resolveLastUpdatedEventIssueIds(undefined, undefined, normalizedUserIds, updateSource);
    }

    if (normalizedType === "created") {
      return this.resolveIssueRowUserIssueIds(normalizedUserIds, ["created_by"]);
    }

    if (normalizedType === "completed") {
      return this.resolveIssueRowUserIssueIds(normalizedUserIds, ["completed_by"]);
    }

    if (normalizedType === "gr_completed") {
      return this.resolveIssueRowUserIssueIds(normalizedUserIds, ["gr_completed_by"]);
    }

    const [timelineIssueIds, issueRowIssueIds] = await Promise.all([
      this.resolveActivityTimelineUserIssueIds(normalizedUserIds),
      this.resolveIssueRowUserIssueIds(normalizedUserIds, ["created_by", "updated_by", "completed_by", "gr_completed_by"]),
    ]);

    return Array.from(new Set([...timelineIssueIds, ...issueRowIssueIds]));
  }

  private getIssueEventActivityType(activityType = "all") {
    return activityType || "all";
  }

  private async resolveLastUpdatedEventIssueIds(fromDate?: string, toDate?: string, userIds?: string[], updateSource = "all"): Promise<number[]> {
    const normalizedUserIds = (userIds || []).map((value) => String(value || "").trim()).filter(Boolean);
    const normalizedUpdateSource = updateSource === "ticket" || updateSource === "timeline" ? updateSource : "all";
    if (!fromDate && !toDate && normalizedUserIds.length === 0 && normalizedUpdateSource === "all") return [];

    const conditions: string[] = ["latest.last_updated_at IS NOT NULL"];
    const params: any[] = [];

    if (fromDate && toDate) {
      conditions.push("DATE(latest.last_updated_at) BETWEEN ? AND ?");
      params.push(fromDate, toDate);
    } else if (fromDate) {
      conditions.push("DATE(latest.last_updated_at) >= ?");
      params.push(fromDate);
    } else if (toDate) {
      conditions.push("DATE(latest.last_updated_at) <= ?");
      params.push(toDate);
    }

    if (normalizedUserIds.length > 0) {
      conditions.push(`latest.last_updated_by IN (${normalizedUserIds.map(() => "?").join(",")})`);
      params.push(...normalizedUserIds);
    }

    if (normalizedUpdateSource !== "all") {
      conditions.push("latest.last_update_source = ?");
      params.push(normalizedUpdateSource);
    }

    const rows = await appDatabase.query(
      `
      SELECT latest.id
      FROM (
        SELECT
          i.id,
          CASE
            WHEN COALESCE(i.updated_at, '1000-01-01') >= COALESCE(t.latest_timeline_at, '1000-01-01')
              THEN i.updated_at
            ELSE t.latest_timeline_at
          END AS last_updated_at,
          CASE
            WHEN COALESCE(i.updated_at, '1000-01-01') >= COALESCE(t.latest_timeline_at, '1000-01-01')
              THEN i.updated_by
            ELSE t.latest_timeline_by
          END AS last_updated_by,
          CASE
            WHEN COALESCE(i.updated_at, '1000-01-01') >= COALESCE(t.latest_timeline_at, '1000-01-01')
              THEN 'ticket'
            ELSE 'timeline'
          END AS last_update_source
        FROM issues i
        LEFT JOIN (
          SELECT ranked.issueId, ranked.latest_timeline_at, ranked.latest_timeline_by
          FROM (
            SELECT
              u.issueId,
              u.createdAt AS latest_timeline_at,
              u.createdBy AS latest_timeline_by,
              ROW_NUMBER() OVER (
                PARTITION BY u.issueId
                ORDER BY u.createdAt DESC, u.id DESC
              ) AS rn
            FROM issues_updates u
            WHERE u.deletedAt IS NULL
              AND COALESCE(u.source, 'securestay') <> 'system'
          ) ranked
          WHERE ranked.rn = 1
        ) t ON t.issueId = i.id
        WHERE i.deleted_at IS NULL
      ) latest
      WHERE ${conditions.join(" AND ")}
      `,
      params
    );

    return rows.map((row: any) => Number(row.id)).filter((id: number) => Number.isFinite(id));
  }

  private async resolveActivityTimelineDateIssueIds(fromDate?: string, toDate?: string): Promise<number[]> {
    const qb = this.issueUpdatesRepo
      .createQueryBuilder("issueUpdate")
      .innerJoin("issueUpdate.issue", "issue")
      .select("issue.id", "id")
      .distinct(true)
      .where("issueUpdate.deletedAt IS NULL")
      .andWhere("COALESCE(issueUpdate.source, 'securestay') <> 'system'");

    if (fromDate && toDate) {
      qb.andWhere("DATE(issueUpdate.createdAt) BETWEEN :fromDate AND :toDate", { fromDate, toDate });
    } else if (fromDate) {
      qb.andWhere("DATE(issueUpdate.createdAt) >= :fromDate", { fromDate });
    } else if (toDate) {
      qb.andWhere("DATE(issueUpdate.createdAt) <= :toDate", { toDate });
    }

    const rows = await qb.getRawMany<{ id: number }>();
    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveResolutionNotesKeywordIssueIds(keyword: string): Promise<number[]> {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) return [];

    const rows = await this.issueRepo
      .createQueryBuilder("issue")
      .select("issue.id", "id")
      .where("issue.resolution LIKE :keyword", { keyword: `%${normalizedKeyword}%` })
      .getRawMany<{ id: number }>();

    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveResolutionNotesPresenceIssueIds(status: string): Promise<number[]> {
    const qb = this.issueRepo
      .createQueryBuilder("issue")
      .select("issue.id", "id");

    if (status === "with-resolution") {
      qb.where("issue.resolution IS NOT NULL").andWhere("TRIM(issue.resolution) <> ''");
    } else if (status === "no-resolution") {
      qb.where("issue.resolution IS NULL OR TRIM(issue.resolution) = ''");
    } else {
      return [];
    }

    const rows = await qb.getRawMany<{ id: number }>();
    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveManagerNotesKeywordIssueIds(keyword: string): Promise<number[]> {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) return [];

    const rows = await this.issueRepo
      .createQueryBuilder("issue")
      .select("issue.id", "id")
      .where("issue.manager_feedback LIKE :keyword", { keyword: `%${normalizedKeyword}%` })
      .getRawMany<{ id: number }>();

    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveManagerNotesPresenceIssueIds(status: string): Promise<number[]> {
    const qb = this.issueRepo
      .createQueryBuilder("issue")
      .select("issue.id", "id");

    if (status === "with-manager-notes") {
      qb.where("issue.manager_feedback IS NOT NULL").andWhere("TRIM(issue.manager_feedback) <> ''");
    } else if (status === "no-manager-notes") {
      qb.where("issue.manager_feedback IS NULL OR TRIM(issue.manager_feedback) = ''");
    } else {
      return [];
    }

    const rows = await qb.getRawMany<{ id: number }>();
    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }

  private async resolveVendorThreadStatusIssueIds(status: string): Promise<number[]> {
    const attachedThreadQb = this.slackMessageRepo
      .createQueryBuilder("slackMessage")
      .select("slackMessage.entityId", "id")
      .where("slackMessage.entityType = :entityType", { entityType: "issue-vendor-thread" });

    if (status === "with-vendor-thread") {
      const rows = await attachedThreadQb.distinct(true).getRawMany<{ id: number }>();
      return rows
        .map((row) => Number(row.id))
        .filter((id: number) => Number.isFinite(id));
    }

    if (status === "no-vendor-thread") {
      const rows = await this.issueRepo
        .createQueryBuilder("issue")
        .select("issue.id", "id")
        .where(`issue.id NOT IN (${attachedThreadQb.getQuery()})`)
        .setParameters(attachedThreadQb.getParameters())
        .getRawMany<{ id: number }>();

      return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    }

    return [];
  }

  private buildFallbackIssueTitle(issue: Partial<Issue>) {
    const description = String(issue.issue_description || "").trim();
    if (!description) return this.normalizeCategory(issue.category);

    const cleaned = description
      .replace(/\s+/g, " ")
      .replace(/^[^a-zA-Z0-9]+/, "")
      .trim();

    const concise = cleaned.split(/[.?!]/)[0]?.trim() || cleaned;
    return concise.length > 68 ? `${concise.slice(0, 65).trim()}...` : concise;
  }

  private buildFallbackChecklist(issue: Partial<Issue>) {
    const category = String(issue.category || "").toUpperCase();
    const defaultSteps = [
      "Acknowledge the guest",
      "Assign the right owner",
      "Coordinate timing and ETA",
      "Confirm resolution with the guest",
    ];

    if (category === "MAINTENANCE") {
      return [
        "Acknowledge the guest",
        "Assign a vendor",
        "Coordinate schedule and ETA",
        "Confirm the fix with the guest",
      ];
    }

    if (category === "CLEANLINESS") {
      return [
        "Acknowledge the guest",
        "Assign the cleaning team",
        "Coordinate access and timing",
        "Confirm guest satisfaction",
      ];
    }

    return defaultSteps;
  }

  private async generateIssueAiFields(issue: Partial<Issue>) {
    const fallback = {
      shortTitle: this.buildFallbackIssueTitle(issue),
      checklist: this.buildFallbackChecklist(issue),
    };

    if (!this.openai || !issue.issue_description) {
      return fallback;
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You generate concise operational issue summaries for an internal dashboard. Return valid JSON with keys shortTitle and checklist. shortTitle must be brief, action-oriented, and under 70 characters. checklist must be an array of up to 4 short coordination-focused steps.",
          },
          {
            role: "user",
            content: JSON.stringify({
              category: issue.category || null,
              description: issue.issue_description || "",
            }),
          },
        ],
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) return fallback;

      const parsed = JSON.parse(content);
      const shortTitle = String(parsed?.shortTitle || fallback.shortTitle).trim();
      const checklist = Array.isArray(parsed?.checklist)
        ? parsed.checklist.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 4)
        : fallback.checklist;

      return {
        shortTitle: shortTitle || fallback.shortTitle,
        checklist: checklist.length > 0 ? checklist : fallback.checklist,
      };
    } catch (error) {
      logger.warn(`[IssuesService] Failed to generate AI issue fields: ${error}`);
      return fallback;
    }
  }

  private async applyAiFields(issue: Issue, force = false) {
    if (!issue.issue_description) return issue;

    const existingChecklist = (() => {
      try {
        return issue.ai_checklist ? JSON.parse(issue.ai_checklist) : [];
      } catch {
        return [];
      }
    })();

    if (!force && issue.ai_short_title && Array.isArray(existingChecklist) && existingChecklist.length > 0) {
      return issue;
    }

    const aiFields = await this.generateIssueAiFields(issue);
    issue.ai_short_title = aiFields.shortTitle;
    issue.ai_checklist = JSON.stringify(aiFields.checklist);
    return await this.issueRepo.save(issue);
  }

  async createIssue(
    data: Partial<Issue>,
    userId: string,
    fileInfo?: {
      fileName: string;
      filePath: string;
      mimeType: string;
      originalName: string;
    }[]
  ) {
    const listing_name =
      (
        await appDatabase
          .getRepository(Listing)
          .findOne({ where: { id: Number(data.listing_id) } })
      )?.internalListingName || "";

    if (data.status === "Completed") {
      data.completed_at = new Date();
      data.completed_by = userId;
    } else {
      data.completed_at = null;
      data.completed_by = null;
    }
    if (data.gr_status === "Completed") {
      data.gr_completed_at = new Date();
      data.gr_completed_by = userId;
    } else {
      data.gr_completed_at = null;
      data.gr_completed_by = null;
    }

    if (data.mistake && data.mistake === "Resolved") {
      data.mistakeResolvedOn = format(new Date(), "yyyy-MM-dd");
    }

    if (!data.nextUpdateDate) {
      data.nextUpdateDate = format(new Date(), "yyyy-MM-dd");
    }

    const newIssue = this.issueRepo.create({
      ...data,
      listing_name: listing_name,
      fileNames: fileInfo
        ? JSON.stringify(fileInfo.map((file) => file.fileName))
        : "[]",
    });

    const savedIssue = await this.issueRepo.save(newIssue);
    await this.applyAiFields(savedIssue, true);

    if (fileInfo) {
      for (const file of fileInfo) {
        const fileRecord = new FileInfo();
        fileRecord.entityType = "issues";
        fileRecord.entityId = savedIssue.id;
        fileRecord.fileName = file.fileName;
        fileRecord.createdBy = userId;
        fileRecord.localPath = file.filePath;
        fileRecord.mimetype = file.mimeType;
        fileRecord.originalName = file.originalName;
        await this.fileInfoRepo.save(fileRecord);
      }
    }
    return savedIssue;
  }

  async getIssues(
    page: number = 1,
    limit: number = 10,
    fromDate: string = "",
    toDate: string = "",
    status: string = "",
    listingId: string = "",
    isClaimOnly?: boolean,
    claimAmount?: string,
    guestName?: string,
    issueIds?: string,
    reservationId?: string
  ) {
    const queryOptions: any = {
      where: {},
      order: {
        created_at: "DESC",
        status: "ASC",
      },
      skip: (page - 1) * limit,
      take: limit,
    };

    if (reservationId) {
      queryOptions.where.reservation_id = reservationId;
    }

    if (issueIds) {
      const idsArray = issueIds.split(",").map((id) => Number(id.trim()));
      queryOptions.where.id = In(idsArray);
    }

    if (fromDate && toDate) {
      const startDate = new Date(fromDate);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(toDate);
      endDate.setDate(endDate.getDate() + 1);
      endDate.setUTCHours(0, 0, 0, 0);

      queryOptions.where.created_at = Between(startDate, endDate);
    } else if (fromDate) {
      const startDate = new Date(fromDate);
      startDate.setUTCHours(0, 0, 0, 0);
      queryOptions.where.created_at = MoreThan(startDate);
    } else if (toDate) {
      const endDate = new Date(toDate);
      endDate.setUTCHours(23, 59, 59, 999);
      queryOptions.where.created_at = LessThan(endDate);
    }

    if (status && Array.isArray(status)) {
      queryOptions.where.status = In(status);
    }

    if (listingId && Array.isArray(listingId)) {
      queryOptions.where.listing_id = In(listingId);
    }

    if (isClaimOnly) {
      queryOptions.where.claim_resolution_status = Not("N/A");
    }

    if (claimAmount) {
      queryOptions.where.claim_resolution_amount = claimAmount;
    }

    if (guestName) {
      queryOptions.where.guest_name = guestName;
    }

    const [issues, total] = await this.issueRepo.findAndCount(queryOptions);

    return {
      data: issues,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updateIssue(
    id: number,
    data: Partial<Issue>,
    userId: string,
    fileInfo?: {
      fileName: string;
      filePath: string;
      mimeType: string;
      originalName: string;
    }[]
  ) {
    const issue = await this.issueRepo.findOne({
      where: { id },
    });

    if (!issue) {
      throw new Error("Issue not found");
    }

    if (Object.prototype.hasOwnProperty.call(data, "status")) {
      if (issue.status !== "Completed" && data.status === "Completed") {
        data.completed_at = new Date();
        data.completed_by = userId;
      } else if (data.status !== "Completed") {
        data.completed_at = null;
        data.completed_by = null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, "gr_status")) {
      if (issue.gr_status !== "Completed" && data.gr_status === "Completed") {
        data.gr_completed_at = new Date();
        data.gr_completed_by = userId;
      } else if (data.gr_status !== "Completed") {
        data.gr_completed_at = null;
        data.gr_completed_by = null;
      }
    }

    if (data.mistake && data.mistake === "Resolved") {
      data.mistakeResolvedOn = format(new Date(), "yyyy-MM-dd");
    }

    if (
      Object.prototype.hasOwnProperty.call(data, "manager_feedback") &&
      String(issue.manager_feedback || "").trim() !== String(data.manager_feedback || "").trim()
    ) {
      data.manager_feedback_updated_at = new Date();
      data.manager_feedback_updated_by = userId;
    }

    let listing_name = "";
    if (data.listing_id) {
      listing_name =
        (
          await appDatabase
            .getRepository(Listing)
            .findOne({ where: { id: Number(data.listing_id) } })
        )?.internalListingName || "";
    }

    if (!data.nextUpdateDate) {
      data.nextUpdateDate = format(new Date(), "yyyy-MM-dd");
    }

    Object.assign(issue, {
      ...data,
      ...(data.listing_id && { listing_name: listing_name }),
      updated_by: userId,
    });

    const updatedData = await this.issueRepo.save(issue);
    const shouldRefreshAi =
      Object.prototype.hasOwnProperty.call(data, "issue_description") ||
      Object.prototype.hasOwnProperty.call(data, "category") ||
      !updatedData.ai_short_title ||
      !updatedData.ai_checklist;
    const finalIssue = shouldRefreshAi ? await this.applyAiFields(updatedData, true) : updatedData;
    if (fileInfo) {
      for (const file of fileInfo) {
        const fileRecord = new FileInfo();
        fileRecord.entityType = "issues";
        fileRecord.entityId = updatedData.id;
        fileRecord.fileName = file.fileName;
        fileRecord.createdBy = userId;
        fileRecord.localPath = file.filePath;
        fileRecord.mimetype = file.mimeType;
        fileRecord.originalName = file.originalName;
        await this.fileInfoRepo.save(fileRecord);
      }
    }
    return finalIssue;
  }

  async deleteIssue(id: number, userId: string) {
    const issue = await this.issueRepo.findOneBy({ id });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with the id ${id} not found`);
    }

    issue.deleted_at = new Date();
    issue.deleted_by = userId;

    await this.issueRepo.save(issue);
    return issue;
  }

  async getUpsells(fromDate: string, toDate: string, listingId: number) {
    return await this.issueRepo.find({
      where: {
        listing_id: String(listingId),
        created_at: Between(new Date(fromDate), new Date(toDate)),
      },
    });
  }

  private formatIssueExportTimestamp(value?: string | Date | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: this.getIssueExportTimeZone(),
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);
    const getPart = (type: string) => parts.find((part) => part.type === type)?.value || "";
    return `${getPart("month")} ${getPart("day")}, ${getPart("year")} • ${getPart("hour")}:${getPart("minute")} ${getPart("dayPeriod")}`;
  }

  private getIssueExportDateTimeParts(value?: string | Date | null) {
    if (!value) return { date: "", time: "" };
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: this.getIssueExportTimeZone(),
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(parsed);
    const getPart = (type: string) => parts.find((part) => part.type === type)?.value || "";
    return {
      date: `${getPart("month")} ${getPart("day")}, ${getPart("year")}`,
      time: `${getPart("hour")}:${getPart("minute")} ${getPart("dayPeriod")}`,
    };
  }

  private getIssueExportTimeZone() {
    return process.env.ISSUES_EXPORT_TIME_ZONE || "America/New_York";
  }

  private formatIssueExportText(value?: any) {
    return String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private getIssueExportTime(value?: string | Date | null) {
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  private getIssueExportDateOnly(value?: string | Date | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: this.getIssueExportTimeZone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const getPart = (type: string) => parts.find((part) => part.type === type)?.value || "";
    return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
  }

  private isIssueExportDateInRange(value: string | Date | null | undefined, fromDate?: string, toDate?: string) {
    const dateOnly = this.getIssueExportDateOnly(value);
    if (!dateOnly) return false;
    if (fromDate && dateOnly < fromDate) return false;
    if (toDate && dateOnly > toDate) return false;
    return true;
  }

  private normalizeIssueExportUsers(value: any) {
    return Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : value
      ? [String(value).trim()].filter(Boolean)
      : [];
  }

  private getIssueExportBaseRow(issue: any) {
    const created = this.getIssueExportDateTimeParts(issue.created_at);
    const updated = this.getIssueExportDateTimeParts(issue.updated_at);
    const completedIr = this.getIssueExportDateTimeParts(issue.completed_at);
    const completedGr = this.getIssueExportDateTimeParts(issue.gr_completed_at);

    return {
      ID: issue.id,
      "IR Status": issue.status,
      "GR Status": issue.gr_status,
      Category: issue.category,
      "Listing ID": issue.listing_id,
      "Listing Name": issue.listing_name,
      "Reservation ID": issue.reservation_id,
      "Check-In Date": issue.check_in_date,
      "Reservation Amount": issue.reservation_amount,
      Channel: issue.channel,
      "Guest Name": issue.guest_name,
      "Guest Contact": issue.guest_contact_number,
      "Issue Description": issue.issue_description,
      "Issue Notes": issue.owner_notes,
      Urgency: issue.urgency,
      Assignee: issue.assigneeName || issue.assignee,
      "Created By": issue.creator,
      "Updated By": issue.updated_by,
      "Created On": created.date,
      "Created At": created.time,
      "Updated On": updated.date,
      "Last Updated At": updated.time,
      "Completed (IR) By": issue.completed_by,
      "Completed (IR) On": completedIr.date,
      "Completed (IR) At": completedIr.time,
      "Completed (GR) By": issue.gr_completed_by,
      "Completed (GR) On": completedGr.date,
      "Completed (GR) At": completedGr.time,
    };
  }

  private getIssueExportEvents(issue: any, updateSource = "all") {
    const normalizedSource = updateSource === "ticket" || updateSource === "timeline" ? updateSource : "all";
    const events: Array<{
      source: "ticket" | "timeline";
      sourceLabel: string;
      timestamp: string | Date | null;
      user: string | null;
      userUid?: string | null;
      details: string;
      sortTime: number;
    }> = [];
    const addEvent = (event: Omit<typeof events[number], "sortTime">) => {
      if (!event.timestamp) return;
      if (normalizedSource !== "all" && event.source !== normalizedSource) return;
      events.push({ ...event, sortTime: this.getIssueExportTime(event.timestamp) });
    };
    const hasTicketEventNear = (timestamp?: string | Date | null) => {
      const time = this.getIssueExportTime(timestamp);
      if (!time) return false;
      return events.some((event) => event.source === "ticket" && Math.abs(event.sortTime - time) <= 2000);
    };

    for (const update of issue.issueUpdates || []) {
      if (update?.deletedAt) continue;
      if (update?.source === "system") {
        addEvent({
          source: "ticket",
          sourceLabel: "Ticket field update",
          timestamp: update.createdAt,
          user: update.createdBy === "system" ? "System" : update.createdBy || null,
          userUid: update.createdByUid || null,
          details: "Ticket fields updated",
        });
        continue;
      }
      addEvent({
        source: "timeline",
        sourceLabel: "Activity timeline update",
        timestamp: update.createdAt,
        user: update.createdBy || null,
        userUid: update.createdByUid || null,
        details: this.formatIssueExportText(update.updates),
      });
    }

    addEvent({
      source: "ticket",
      sourceLabel: "Ticket field update",
      timestamp: issue.completed_at,
      user: issue.completed_by || null,
      userUid: issue.completed_by_uid || null,
      details: "IR status completed",
    });
    addEvent({
      source: "ticket",
      sourceLabel: "Ticket field update",
      timestamp: issue.gr_completed_at,
      user: issue.gr_completed_by || null,
      userUid: issue.gr_completed_by_uid || null,
      details: "GR status completed",
    });

    if (issue.updated_at && !hasTicketEventNear(issue.updated_at)) {
      addEvent({
        source: "ticket",
        sourceLabel: "Ticket field update",
        timestamp: issue.updated_at,
        user: issue.updated_by || null,
        userUid: issue.updated_by_uid || null,
        details: "Ticket fields updated",
      });
    }

    return events.sort((left, right) => right.sortTime - left.sortTime);
  }

  private filterIssueExportEvents(issue: any, events: ReturnType<IssuesService["getIssueExportEvents"]>, filters: any) {
    const activityType = filters.activityType || "all";
    const activityFromDate = filters.activityFromDate as string | undefined;
    const activityToDate = filters.activityToDate as string | undefined;
    const activityUsers = new Set(this.normalizeIssueExportUsers(filters.activityUser));
    const matchesActivityUser = (event: typeof events[number]) =>
      activityUsers.size === 0 || (event.userUid && activityUsers.has(event.userUid));
    const matchesActivityDate = (event: typeof events[number]) =>
      !activityFromDate && !activityToDate
        ? true
        : this.isIssueExportDateInRange(event.timestamp, activityFromDate, activityToDate);

    if (activityType === "updated") {
      return events.filter((event) => {
        if (!matchesActivityUser(event)) return false;
        if (!matchesActivityDate(event)) return false;
        return true;
      });
    }

    if (activityType === "last_updated") {
      const latest = events[0];
      if (!latest || !matchesActivityUser(latest)) return [];
      if (!matchesActivityDate(latest)) return [];
      return [latest];
    }

    if (activityType === "completed") {
      return events.filter((event) => {
        if (event.details !== "IR status completed") return false;
        if (!matchesActivityUser(event)) return false;
        if (!matchesActivityDate(event)) return false;
        return true;
      });
    }

    if (activityType === "gr_completed") {
      return events.filter((event) => {
        if (event.details !== "GR status completed") return false;
        if (!matchesActivityUser(event)) return false;
        if (!matchesActivityDate(event)) return false;
        return true;
      });
    }

    return events.filter((event) => matchesActivityUser(event) && matchesActivityDate(event));
  }

  async exportIssuesToExcel(filters: any): Promise<Buffer> {
    const exportLimit = Number(process.env.ISSUES_EXPORT_LIMIT || 100000);
    const result = await this.getGuestIssues(
      {
        ...filters,
        page: 1,
        limit: exportLimit,
      },
      filters.userId
    );

    const formattedData = (result.issues || []).flatMap((issue: any) => {
      const baseRow = this.getIssueExportBaseRow(issue);
      const events = this.filterIssueExportEvents(
        issue,
        this.getIssueExportEvents(issue, filters.updateSource || "all"),
        filters
      );
      return events.map((event) => ({
        ...baseRow,
        "Activity Type": event.sourceLabel,
        "Update Timestamp": this.formatIssueExportTimestamp(event.timestamp),
        "Update User": event.user || "",
        "Update Details": event.details,
      }));
    });

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const csv = XLSX.utils.sheet_to_csv(worksheet);

    return Buffer.from(csv, "utf-8");
  }

  async checkUnresolvedIssues() {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const unresolvedIssues = await this.issueRepo.find({
      where: {
        status: Not("Completed"),
        created_at: LessThan(threeDaysAgo),
      },
    });

    if (unresolvedIssues.length > 0) {
      await sendUnresolvedIssuesEmail(unresolvedIssues);
    }
  }

  public async getIssuesByReservationId(reservationId: string) {
    const issues = await this.issueRepo.find({
      where: {
        reservation_id: reservationId,
      },
    });

    const listingIds = Array.from(new Set(issues.map((issue) => Number(issue.listing_id)).filter(Boolean)));
    const listings = listingIds.length
      ? await appDatabase.getRepository(Listing).find({ where: { id: In(listingIds as number[]) } })
      : [];
    const listingMap = new Map(listings.map((listing) => [Number(listing.id), listing]));
    const userDirectory = await this.buildIssueUserDirectory();
    const userMap = new Map(userDirectory.map((user) => [user.uid, user]));
    const userEmailMap = new Map(
      userDirectory
        .filter((user) => user.email)
        .map((user) => [user.email as string, user])
    );

    return issues.map((issue) => {
      const listing = listingMap.get(Number(issue.listing_id));
      const creatorEmail = String(issue.creator || "").trim().toLowerCase();
      const createdByUser = userMap.get(issue.created_by) || (creatorEmail ? userEmailMap.get(creatorEmail) : undefined);
      const creatorName = createdByUser?.name || issue.creator || issue.created_by || null;
      return {
        ...issue,
        creator: creatorName,
        created_by: createdByUser?.name || issue.created_by,
        createdByName: createdByUser?.name || null,
        creatorName,
        propertyTypeTag: this.extractPropertyTypeTag(listing?.tags),
        serviceTypeTag: this.extractServiceTypeTag(listing?.tags),
      };
    });
  }

  // Batch version of getIssuesByReservationId — one DB query for all reservation IDs.
  // Returns a map of reservationId → issues[].
  public async getIssuesByReservationIds(reservationIds: string[]): Promise<Record<string, any[]>> {
    if (reservationIds.length === 0) return {};

    const issues = await this.issueRepo.find({
      where: { reservation_id: In(reservationIds) },
    });

    const listingIds = Array.from(new Set(issues.map((issue) => Number(issue.listing_id)).filter(Boolean)));
    const listings = listingIds.length
      ? await appDatabase.getRepository(Listing).find({ where: { id: In(listingIds as number[]) } })
      : [];
    const listingMap = new Map(listings.map((listing) => [Number(listing.id), listing]));
    const userDirectory = await this.buildIssueUserDirectory();
    const userMap = new Map(userDirectory.map((user) => [user.uid, user]));
    const userEmailMap = new Map(
      userDirectory.filter((user) => user.email).map((user) => [user.email as string, user])
    );

    const grouped: Record<string, any[]> = Object.fromEntries(reservationIds.map((id) => [id, []]));
    for (const issue of issues) {
      const key = issue.reservation_id;
      if (!key || !grouped[key]) continue;
      const listing = listingMap.get(Number(issue.listing_id));
      const creatorEmail = String(issue.creator || "").trim().toLowerCase();
      const createdByUser = userMap.get(issue.created_by) || (creatorEmail ? userEmailMap.get(creatorEmail) : undefined);
      const creatorName = createdByUser?.name || issue.creator || issue.created_by || null;
      grouped[key].push({
        ...issue,
        creator: creatorName,
        created_by: createdByUser?.name || issue.created_by,
        createdByName: createdByUser?.name || null,
        creatorName,
        propertyTypeTag: this.extractPropertyTypeTag(listing?.tags),
        serviceTypeTag: this.extractServiceTypeTag(listing?.tags),
      });
    }
    return grouped;
  }

  async getIssueById(id: number) {
    const issue = await this.issueRepo.findOne({ where: { id } });
    if (!issue) {
      throw new Error("Issue not found");
    }
    return issue;
  }

  async getIssuesByListingId(listingId: string) {
    return await this.issueRepo.find({
      where: {
        listing_id: String(listingId),
        status: Not("Completed"),
      },
    });
  }

  async getIssuesByListingIds(listingIds: string[]) {
    if (listingIds.length === 0) return [];
    return await this.issueRepo.find({
      where: {
        listing_id: In(listingIds),
        status: Not("Completed"),
      },
    });
  }

  async migrateIssueToActionItems(body: any, userId: string) {
    const { id, category, status } = body;
    const issue = await this.issueRepo.findOne({
      where: { id },
      relations: ["issueUpdates"],
    });

    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
    }

    // Create a new action item based on the issue
    const actionItem: Partial<ActionItems> = {
      item: `[MOVED FROM ISSUES PAGE]  ${issue.issue_description}`,
      category: category,
      status: status,
      createdBy: userId,
      listingId: Number(issue.listing_id),
      reservationId: Number(issue.reservation_id),
      listingName: issue.listing_name,
      guestName: issue.guest_name,
    };

    // Save the action item to the database
    const newActionItem = this.actionItemRepo.create(actionItem);
    const savedActionItem = await this.actionItemRepo.save(newActionItem);

    // Save ALL issue updates as action item updates
    if (issue.issueUpdates?.length > 0) {
      const actionItemUpdates = issue.issueUpdates.map((update) =>
        this.actionItemUpdatesRepo.create({
          updates: update.updates,
          createdBy: update.createdBy,
          updatedBy: update.updatedBy,
          createdAt: update.createdAt,
          updatedAt: update.updatedAt,
          actionItems: savedActionItem,
        })
      );

      await this.actionItemUpdatesRepo.save(actionItemUpdates); // save all at once
    }

    await this.issueRepo.remove(issue);
    return savedActionItem;
  }

  async createIssueUpdates(
    body: any,
    userId: string,
    fileInfo?: {
      fileName: string;
      filePath: string;
      mimeType: string;
      originalName: string;
    }[]
  ) {
    const { issueId, updates, source } = body;
    const issueIds = this.normalizeIssueUpdateIds(issueId);
    const createdUpdates = [];

    for (const normalizedIssueId of issueIds) {
      const issue = await this.issueRepo.findOne({ where: { id: normalizedIssueId } });
      if (!issue) {
        throw CustomErrorHandler.notFound(`Issue with ID ${normalizedIssueId} not found`);
      }

      const newUpdate = this.issueUpdatesRepo.create({
        issue: issue,
        updates: updates || "",
        createdBy: userId,
        source: source === "system" ? "system" : "securestay",
      });

      let result = await this.issueUpdatesRepo.save(newUpdate, { listeners: false });
      if (fileInfo?.length) {
        for (const file of fileInfo) {
          const fileRecord = this.fileInfoRepo.create({
            entityType: "issue-updates",
            entityId: result.id,
            fileName: file.fileName,
            localPath: file.filePath,
            mimetype: file.mimeType,
            originalName: file.originalName,
            createdBy: userId,
          });
          await this.fileInfoRepo.save(fileRecord);
        }
      }

      result = await this.postIssueUpdateToSlackThread(result, issue, userId);
      createdUpdates.push(result);
    }

    const userDirectory = await this.buildIssueUserDirectory();
    const userMap = new Map(userDirectory.map((user) => [user.uid, user]));
    const formattedUpdates = await Promise.all(
      createdUpdates.map(async (result) => {
        const createdUser = userMap.get(result.createdBy);
        const updatedUser = userMap.get(result.updatedBy);
        const attachedFiles = await this.fileInfoRepo.find({
          where: { entityType: "issue-updates", entityId: result.id },
        });
        return {
          ...result,
          source: result.source === "system" ? "system" : "securestay",
          createdByUid: result.createdBy,
          updatedByUid: result.updatedBy,
          createdByDepartment: createdUser?.department || null,
          updatedByDepartment: updatedUser?.department || null,
          createdBy: createdUser?.name || result.createdBy,
          updatedBy: updatedUser?.name || result.updatedBy,
          userAvatar: result.source === "system" ? null : (createdUser?.avatarUrl || null),
          fileInfo: attachedFiles,
        };
      })
    );

    return Array.isArray(issueId) || issueIds.length > 1 ? formattedUpdates : formattedUpdates[0];
  }

  async updateIssueUpdates(body: any, userId: string) {
    const { id, updates } = body;

    const existingIssueUpdate = await this.issueUpdatesRepo.findOne({
      where: { id },
      relations: ["issue"],
    });
    if (!existingIssueUpdate) {
      throw CustomErrorHandler.notFound(`Issue update with ID ${id} not found`);
    }
    existingIssueUpdate.updates = updates;
    existingIssueUpdate.updatedBy = userId;

    const result = await this.issueUpdatesRepo.save(existingIssueUpdate);
    const trackedSlackUpdate = await this.getTrackedIssueUpdateSlackMessage(result);
    if (trackedSlackUpdate) {
      try {
        const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
        const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";
        const listingInfo = await appDatabase.getRepository(Listing).findOne({
          where: {
            id: Number(existingIssueUpdate.issue?.listing_id),
          },
        });
        const slackMessage = buildIssueUpdateMessage(existingIssueUpdate, listingInfo?.internalListingName, user);
        const { channel, ...messageWithoutChannel } = slackMessage;
        await updateSlackMessage(messageWithoutChannel, trackedSlackUpdate.messageTs, trackedSlackUpdate.channel);
      } catch (error) {
        logger.error("Slack issue update sync failed", error);
      }
    }

    const userDirectory = await this.buildIssueUserDirectory();
    const userMap = new Map(userDirectory.map((user) => [user.uid, user]));
    const createdUser = userMap.get(result.createdBy);
    const updatedUser = userMap.get(result.updatedBy);
    const attachedFiles = await this.fileInfoRepo.find({
      where: { entityType: "issue-updates", entityId: result.id },
    });
    return {
      ...result,
      source: "securestay",
      createdByUid: result.createdBy,
      updatedByUid: result.updatedBy,
      createdByDepartment: createdUser?.department || null,
      updatedByDepartment: updatedUser?.department || null,
      createdBy: createdUser?.name || result.createdBy,
      updatedBy: updatedUser?.name || result.updatedBy,
      userAvatar: createdUser?.avatarUrl || null,
      fileInfo: attachedFiles,
    };
  }

  async deleteIssueUpdates(id: number, userId: string) {
    const issueUpdate = await this.issueUpdatesRepo.findOne({
      where: { id },
      relations: ["issue"],
    });
    if (!issueUpdate) {
      throw CustomErrorHandler.notFound(
        `Issue update with the id ${id} not found`
      );
    }

    if (issueUpdate.source !== "slack") {
      await this.deleteTrackedIssueUpdateSlackMessage(issueUpdate);
    }

    issueUpdate.deletedAt = new Date();
    issueUpdate.deletedBy = userId;

    await this.issueUpdatesRepo.save(issueUpdate);
    return issueUpdate;
  }

  async getGuestIssues(body: any, userId: string) {
    const {
      category,
      listingId,
      propertyType,
      fromDate,
      toDate,
      status,
      grStatus,
      guestName,
      isClaimOnly,
      claimAmount,
      page,
      limit,
      issueId,
      reservationId,
      keyword,
      keywordField,
      channel,
      dateType,
      stayStatus,
      assignee,
      urgency,
      activityType,
      activityUser,
      activityFromDate,
      activityToDate,
      updateSource,
      activityKeyword,
      vendorThreadStatus,
      issueResolution,
      guestSentiment,
      serviceType,
      resolutionNotesStatus,
      resolutionNotesKeyword,
      managerNotesStatus,
      managerNotesKeyword,
    } = body;

    const hasListingTypeFilter = Boolean(propertyType?.length || serviceType?.length);
    let listingIds = Array.isArray(listingId) ? listingId : [];
    const listingService = new ListingService();
    if (propertyType && propertyType.length > 0) {
      const propertyTypeListingIds = (
        await listingService.getListingsByPropertyTypes(propertyType, userId)
      ).map((l) => l.id);
      listingIds = listingIds.length > 0
        ? listingIds.filter((id: any) => propertyTypeListingIds.map(String).includes(String(id)))
        : propertyTypeListingIds;
    }

    if (serviceType && serviceType.length > 0) {
      const serviceTypeListingIds = (
        await listingService.getListingsByServiceTypes(serviceType, userId)
      ).map((l) => l.id);
      listingIds = listingIds.length > 0
        ? listingIds.filter((id: any) => serviceTypeListingIds.map(String).includes(String(id)))
        : serviceTypeListingIds;
    }

    if (hasListingTypeFilter && listingIds.length === 0) {
      return { issues: [], total: 0 };
    }

    const issueStatus = status;
    const grIssueStatus = grStatus;
    const currentDate = format(new Date(), "yyyy-MM-dd");

    // dateType=created/completed/gr_completed/due filters on the Issue table directly.
    // dateType=activity_updated resolves any update event from either issue.updated_at
    // or issue timeline entries. dateType=updated/last_updated resolves the latest
    // update event across those same two sources.
    // dateType=check_in/check_out and stayStatus require resolving matching
    // reservation IDs from reservation_info, since Issue has no check_out_date
    // and stay status is computed from arrival/departure dates.
    const needsReservationLookup =
      ((dateType === "check_in" || dateType === "check_out") && (fromDate || toDate)) ||
      (Array.isArray(stayStatus) && stayStatus.length > 0);

    let resolvedReservationIds: number[] | undefined;
    if (needsReservationLookup) {
      const reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
      const qb = reservationRepo.createQueryBuilder("r").select("r.id", "id");

      if (dateType === "check_in") {
        if (fromDate && toDate) {
          qb.andWhere("r.arrivalDate BETWEEN :fromDate AND :toDate", { fromDate, toDate });
        } else if (fromDate) {
          qb.andWhere("r.arrivalDate >= :fromDate", { fromDate });
        } else if (toDate) {
          qb.andWhere("r.arrivalDate <= :toDate", { toDate });
        }
      } else if (dateType === "check_out") {
        if (fromDate && toDate) {
          qb.andWhere("r.departureDate BETWEEN :fromDate AND :toDate", { fromDate, toDate });
        } else if (fromDate) {
          qb.andWhere("r.departureDate >= :fromDate", { fromDate });
        } else if (toDate) {
          qb.andWhere("r.departureDate <= :toDate", { toDate });
        }
      }

      if (Array.isArray(stayStatus) && stayStatus.length > 0) {
        const stayConditions: string[] = [];
        if (stayStatus.includes("currently-staying")) {
          stayConditions.push("(DATE(r.arrivalDate) <= :today AND DATE(r.departureDate) > :today)");
        }
        if (stayStatus.includes("co-today")) {
          stayConditions.push("DATE(r.departureDate) = :today");
        }
        if (stayStatus.includes("past")) {
          stayConditions.push("DATE(r.departureDate) < :today");
        }
        if (stayStatus.includes("upcoming")) {
          stayConditions.push("DATE(r.arrivalDate) > :today");
        }
        if (stayConditions.length > 0) {
          qb.andWhere(`(${stayConditions.join(" OR ")})`, { today: currentDate });
        }
      }

      const rows = await qb.getRawMany<{ id: number }>();
      resolvedReservationIds = rows.map((r) => Number(r.id));

      if (reservationId && reservationId.length > 0) {
        const requested = new Set(reservationId.map((id: any) => Number(id)));
        resolvedReservationIds = resolvedReservationIds.filter((id) => requested.has(id));
      }

      if (resolvedReservationIds.length === 0) {
        return { issues: [], total: 0 };
      }
    }

    const effectiveReservationIds = resolvedReservationIds ?? reservationId;

    let dateColumn: "created_at" | "updated_at" | "completed_at" | "gr_completed_at" | "due_date" | null = null;
    if (fromDate || toDate) {
      if (dateType === "due") dateColumn = "due_date";
    }
    const dateColumnFilter = dateColumn
      ? this.buildIssueCalendarDateFilter(fromDate, toDate)
      : undefined;

    const normalizedAssignee = Array.isArray(assignee)
      ? assignee.filter(Boolean)
      : assignee
      ? [assignee]
      : [];
    const normalizedUrgency = Array.isArray(urgency)
      ? urgency.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value))
      : urgency
      ? [Number(urgency)].filter((value: number) => Number.isFinite(value))
      : [];
    const normalizedActivityUsers = Array.isArray(activityUser)
      ? activityUser.map((value: any) => String(value || "").trim()).filter(Boolean)
      : activityUser
      ? [String(activityUser).trim()].filter(Boolean)
      : [];
    const normalizedUpdateSource = updateSource === "ticket" || updateSource === "timeline" ? updateSource : "all";
    const eventActivityType = this.getIssueEventActivityType(activityType || "all");
    const hasActivityDateRange = Boolean(activityFromDate || activityToDate);

    const normalizedKeyword = String(keyword || "").trim();
    const normalizedActivityKeyword = String(activityKeyword || "").trim();
    const normalizedVendorThreadStatus = String(vendorThreadStatus || "").trim();
    const normalizedResolutionNotesKeyword = String(resolutionNotesKeyword || "").trim();
    const normalizedResolutionNotesStatus = String(resolutionNotesStatus || "").trim();
    const normalizedManagerNotesKeyword = String(managerNotesKeyword || "").trim();
    const normalizedManagerNotesStatus = String(managerNotesStatus || "").trim();
    const requestedIssueIds = Array.isArray(issueId)
      ? issueId.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))
      : issueId
      ? [Number(issueId)].filter((id: number) => Number.isFinite(id))
      : [];
    // Run all resolver queries in parallel to reduce filter latency.
    const [
      keywordIssueIds,
      activityKeywordIssueIds,
      activityUserIssueIds,
      activityTimelineDateIssueIds,
      vendorThreadStatusIssueIds,
      resolutionNotesKeywordIssueIds,
      resolutionNotesPresenceIssueIds,
      managerNotesKeywordIssueIds,
      managerNotesPresenceIssueIds,
    ] = await Promise.all([
      normalizedKeyword ? this.resolveKeywordIssueIds(normalizedKeyword, keywordField) : Promise.resolve(undefined),
      normalizedActivityKeyword ? this.resolveActivityKeywordIssueIds(normalizedActivityKeyword) : Promise.resolve(undefined),
      normalizedActivityUsers.length > 0 && !hasActivityDateRange
        ? this.resolveActivityUserIssueIds(eventActivityType, normalizedActivityUsers, normalizedUpdateSource)
        : Promise.resolve(undefined),
      normalizedActivityUsers.length > 0 && hasActivityDateRange
        ? this.resolveActivityEventUserDateIssueIds(eventActivityType, normalizedActivityUsers, activityFromDate, activityToDate, normalizedUpdateSource)
        : hasActivityDateRange
        ? this.resolveActivityEventDateIssueIds(eventActivityType, activityFromDate, activityToDate, normalizedUpdateSource)
        : eventActivityType === "last_updated" && normalizedUpdateSource !== "all"
        ? this.resolveLastUpdatedEventIssueIds(undefined, undefined, undefined, normalizedUpdateSource)
        : eventActivityType === "updated" && normalizedUpdateSource !== "all"
        ? this.resolveUpdatedEventDateIssueIds(undefined, undefined, normalizedUpdateSource)
        : Promise.resolve(undefined),
      normalizedVendorThreadStatus ? this.resolveVendorThreadStatusIssueIds(normalizedVendorThreadStatus) : Promise.resolve(undefined),
      normalizedResolutionNotesKeyword ? this.resolveResolutionNotesKeywordIssueIds(normalizedResolutionNotesKeyword) : Promise.resolve(undefined),
      normalizedResolutionNotesStatus ? this.resolveResolutionNotesPresenceIssueIds(normalizedResolutionNotesStatus) : Promise.resolve(undefined),
      normalizedManagerNotesKeyword ? this.resolveManagerNotesKeywordIssueIds(normalizedManagerNotesKeyword) : Promise.resolve(undefined),
      normalizedManagerNotesStatus ? this.resolveManagerNotesPresenceIssueIds(normalizedManagerNotesStatus) : Promise.resolve(undefined),
    ]);
    let effectiveIssueIds = requestedIssueIds.length > 0 ? requestedIssueIds : undefined;

    const applyIssueIdFilter = (ids?: number[]) => {
      if (!ids) return true;
      if (ids.length === 0) return false;
      effectiveIssueIds = effectiveIssueIds
        ? effectiveIssueIds.filter((id) => ids.includes(id))
        : ids;
      return effectiveIssueIds.length > 0;
    };

    if (!applyIssueIdFilter(keywordIssueIds)) {
      return { issues: [], total: 0 };
    }

    if (!applyIssueIdFilter(activityKeywordIssueIds)) {
      return { issues: [], total: 0 };
    }

    if (!applyIssueIdFilter(activityUserIssueIds)) {
      return { issues: [], total: 0 };
    }

    if (!applyIssueIdFilter(activityTimelineDateIssueIds)) {
      return { issues: [], total: 0 };
    }

    if (!applyIssueIdFilter(vendorThreadStatusIssueIds)) {
      return { issues: [], total: 0 };
    }

    if (!applyIssueIdFilter(resolutionNotesKeywordIssueIds)) {
      return { issues: [], total: 0 };
    }

    if (!applyIssueIdFilter(resolutionNotesPresenceIssueIds)) {
      return { issues: [], total: 0 };
    }

    if (!applyIssueIdFilter(managerNotesKeywordIssueIds)) {
      return { issues: [], total: 0 };
    }

    if (!applyIssueIdFilter(managerNotesPresenceIssueIds)) {
      return { issues: [], total: 0 };
    }

    const [issues, total] = await this.issueRepo.findAndCount({
      where: {
        ...(category && category.length > 0 && { category: In(category) }),
        ...(listingIds &&
          listingIds.length > 0 && { listing_id: In(listingIds) }),
        ...(issueStatus &&
          issueStatus.length > 0 && { status: In(issueStatus) }),
        ...(grIssueStatus &&
          grIssueStatus.length > 0 && { gr_status: In(grIssueStatus) }),
        ...(dateColumn && dateColumnFilter && { [dateColumn]: dateColumnFilter }),
        ...(guestName && { guest_name: guestName }),
        ...(isClaimOnly && { claim_resolution_status: Not("N/A") }),
        ...(claimAmount && { claim_resolution_amount: claimAmount }),
        ...(effectiveIssueIds &&
          effectiveIssueIds.length > 0 && { id: In(effectiveIssueIds) }),
        ...(effectiveReservationIds &&
          effectiveReservationIds.length > 0 && { reservation_id: In(effectiveReservationIds) }),
        ...(channel && channel.length > 0 && { channel: In(channel) }),
        ...(normalizedAssignee.length > 0 && { assignee: In(normalizedAssignee) }),
        ...(normalizedUrgency.length > 0 && { urgency: In(normalizedUrgency) }),
        ...(eventActivityType === "completed" && { completed_at: Not(IsNull()) }),
        ...(eventActivityType === "gr_completed" && { gr_completed_at: Not(IsNull()) }),
        ...(issueResolution && { ai_resolution_status: issueResolution }),
        ...(guestSentiment && { ai_guest_sentiment: guestSentiment }),
      },
      take: limit,
      skip: (Number(page) - 1) * Number(limit),
      order: {
        id: "DESC",
      },
    });

    // Batch-load issueUpdates for the current page in one query instead of the ORM eager join.
    const pageIssueIdsForUpdates = issues.map((issue) => issue.id);
    const pageIssueUpdates = pageIssueIdsForUpdates.length
      ? await this.issueUpdatesRepo.find({
          where: { issue: { id: In(pageIssueIdsForUpdates) } as any },
          relations: ["issue"],
        })
      : [];
    const updatesByIssueId = new Map<number, IssueUpdates[]>();
    for (const update of pageIssueUpdates) {
      const issueId = (update.issue as any)?.id;
      if (issueId) {
        if (!updatesByIssueId.has(issueId)) updatesByIssueId.set(issueId, []);
        updatesByIssueId.get(issueId)!.push(update);
      }
    }
    for (const issue of issues) {
      (issue as any).issueUpdates = updatesByIssueId.get(issue.id) || [];
    }

    const listingIdsToLoad = Array.from(
      new Set(issues.map((issue) => Number(issue.listing_id)).filter(Boolean))
    );
    const listings = listingIdsToLoad.length
      ? await appDatabase.getRepository(Listing).find({ where: { id: In(listingIdsToLoad as number[]) } })
      : [];
    const listingMap = new Map(listings.map((listing) => [Number(listing.id), listing]));

    // Batch-load all reservations for the current page in one query (avoids N+1).
    const reservationIdsToLoad = Array.from(new Set(
      issues
        .map((i) => i.reservation_id)
        .filter((rid): rid is string => Boolean(rid) && rid !== "NA" && !Number.isNaN(Number(rid)))
        .map(Number)
    ));
    const reservationMap = new Map<number, ReservationInfoEntity>();
    if (reservationIdsToLoad.length > 0) {
      const reservations = await appDatabase
        .getRepository(ReservationInfoEntity)
        .find({ where: { id: In(reservationIdsToLoad) } });
      reservations.forEach((r) => reservationMap.set(r.id, r));
    }
    for (const issue of issues) {
      const issueWithInfo = issue as Issue & { reservationInfo?: any };
      issueWithInfo.reservationInfo =
        issue.reservation_id && issue.reservation_id !== "NA"
          ? (reservationMap.get(Number(issue.reservation_id)) ?? null)
          : null;
    }

    const userDirectory = await this.buildIssueUserDirectory();
    const userMap = new Map(userDirectory.map((user) => [user.uid, user]));

    // Scope file_info query to the current page's issue and update IDs (avoids full table scan).
    const pageIssueIds = issues.map((issue) => issue.id);
    const pageUpdateIds = issues.flatMap((issue) => (issue.issueUpdates || []).map((u) => u.id));
    const fileInfoList =
      pageIssueIds.length === 0 && pageUpdateIds.length === 0
        ? []
        : await this.fileInfoRepo.find({
            where: [
              ...(pageIssueIds.length > 0
                ? [{ entityType: "issues", entityId: In(pageIssueIds) }]
                : []),
              ...(pageUpdateIds.length > 0
                ? [{ entityType: "issue-updates", entityId: In(pageUpdateIds) }]
                : []),
            ],
          });

    const transformedIssues = issues.map((issue) => {
      const listing = listingMap.get(Number(issue.listing_id));
      const parsedChecklist = (() => {
        try {
          return issue.ai_checklist ? JSON.parse(issue.ai_checklist) : [];
        } catch {
          return [];
        }
      })();
      return {
        ...issue,
        created_by_uid: issue.created_by,
        updated_by_uid: issue.updated_by,
        completed_by_uid: issue.completed_by,
        gr_completed_by_uid: issue.gr_completed_by,
        created_by: userMap.get(issue.created_by)?.name || issue.created_by,
        updated_by: userMap.get(issue.updated_by)?.name || issue.updated_by,
        completed_by: userMap.get(issue.completed_by)?.name || issue.completed_by,
        gr_completed_by: userMap.get(issue.gr_completed_by)?.name || issue.gr_completed_by,
        resolution_refreshed_by_name: userMap.get(issue.resolution_refreshed_by)?.name || (issue.resolution_refreshed_by === "system" ? "System" : issue.resolution_refreshed_by),
        manager_feedback_updated_by_name: userMap.get(issue.manager_feedback_updated_by)?.name || issue.manager_feedback_updated_by,
        issueUpdates: issue.issueUpdates.map((update) => {
          const isSlack = update.source === "slack";
          const isSystem = update.source === "system";
          return {
            ...update,
            source: isSlack ? "slack" : isSystem ? "system" : "securestay",
            createdByUid: isSlack ? null : update.createdBy,
            updatedByUid: isSlack ? null : update.updatedBy,
            createdByDepartment: isSlack ? null : (userMap.get(update.createdBy)?.department || null),
            updatedByDepartment: isSlack ? null : (userMap.get(update.updatedBy)?.department || null),
            createdBy: isSlack ? update.createdBy : (userMap.get(update.createdBy)?.name || update.createdBy),
            updatedBy: isSlack ? update.updatedBy : (userMap.get(update.updatedBy)?.name || update.updatedBy),
            userAvatar: isSlack || isSystem ? null : (userMap.get(update.createdBy)?.avatarUrl || null),
            fileInfo: fileInfoList.filter((file) => file.entityType === "issue-updates" && file.entityId === update.id),
          };
        }),
        fileInfo: fileInfoList.filter((file) => file.entityType === "issues" && file.entityId === issue.id),
        assigneeName: userMap.get(issue.assignee)?.name || issue.assignee,
        propertyTypeTag: this.extractPropertyTypeTag(listing?.tags),
        serviceTypeTag: this.extractServiceTypeTag(listing?.tags),
        ai_short_title: issue.ai_short_title,
        ai_checklist: parsedChecklist,
      };
    });

    return {
      issues: transformedIssues,
      total,
      assigneeList: userDirectory.map((user) => ({ uid: user.uid, name: user.name })),
    };
  }

  async getIssueThread(issueId: number) {
    const issue = await this.issueRepo.findOne({
      where: { id: issueId },
      relations: ["issueUpdates"],
    });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${issueId} not found`);
    }

    const userDirectory = await this.buildIssueUserDirectory();
    const userMap = new Map(userDirectory.map((user) => [user.uid, user]));

    const nonDeletedUpdates = (issue.issueUpdates || []).filter((update) => !update.deletedAt);
    const updateIds = nonDeletedUpdates.map((u) => u.id);
    const allFileInfos = updateIds.length
      ? await this.fileInfoRepo.find({ where: { entityType: "issue-updates", entityId: In(updateIds) } })
      : [];
    const fileInfoByUpdateId = new Map<number, FileInfo[]>();
    for (const fi of allFileInfos) {
      if (!fileInfoByUpdateId.has(fi.entityId)) fileInfoByUpdateId.set(fi.entityId, []);
      fileInfoByUpdateId.get(fi.entityId)!.push(fi);
    }

    const persistedUpdates = nonDeletedUpdates.map((update) => {
      const isSlack = update.source === "slack";
      const isSystem = update.source === "system";
      const files = fileInfoByUpdateId.get(update.id) || [];
      return {
        id: update.id,
        updates: update.updates,
        createdAt: update.createdAt,
        updatedAt: update.updatedAt,
        deletedAt: update.deletedAt,
        source: isSlack ? "slack" : isSystem ? "system" : "securestay",
        slackMessageTs: update.slackMessageTs || null,
        createdByUid: isSlack ? null : update.createdBy,
        updatedByUid: isSlack ? null : update.updatedBy,
        createdByDepartment: isSlack ? null : (userMap.get(update.createdBy)?.department || null),
        updatedByDepartment: isSlack ? null : (userMap.get(update.updatedBy)?.department || null),
        createdBy: isSlack ? update.createdBy : (userMap.get(update.createdBy)?.name || update.createdBy),
        updatedBy: isSlack ? update.updatedBy : (userMap.get(update.updatedBy)?.name || update.updatedBy),
        userAvatar: isSlack || isSystem ? null : (userMap.get(update.createdBy)?.avatarUrl || null),
        fileInfo: files.map((fi) => {
          const proxyUrl = (fi.status === "uploaded" && fi.driveFileId)
            ? `/getdriveimage/${fi.driveFileId}`
            : (fi.fileName ? `/getfile/issues/${fi.fileName}` : null);
          return {
            id: fi.id,
            fileName: fi.fileName,
            originalName: fi.originalName,
            mimeType: fi.mimetype,
            url: proxyUrl,
            webViewLink: fi.webViewLink,
            webContentLink: fi.webContentLink,
            link: proxyUrl,
          };
        }),
      };
    });

    const trackedSlackMessage = await this.slackMessageRepo.findOne({
      where: {
        entityType: "issues",
        entityId: issueId,
      },
      order: {
        createdAt: "DESC",
      },
    });

    if (!trackedSlackMessage) {
      return {
        entries: [],
        persistedUpdates,
        threadUrl: null,
      };
    }

    try {
      let threadUrl: string | null = null;
      try {
        const permalinkResponse = await axios.get("https://slack.com/api/chat.getPermalink", {
          headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          },
          params: {
            channel: trackedSlackMessage.channel,
            message_ts: trackedSlackMessage.threadTs || trackedSlackMessage.messageTs,
          },
        });
        if (permalinkResponse.data?.ok) {
          threadUrl = permalinkResponse.data?.permalink || null;
        }
      } catch (error) {
        logger.warn(
          `[IssuesService][getIssueThread] Failed to fetch Slack permalink for issue ${issueId}: ${error}`
        );
      }

      const response = await axios.get("https://slack.com/api/conversations.replies", {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        },
        params: {
          channel: trackedSlackMessage.channel,
          ts: trackedSlackMessage.threadTs || trackedSlackMessage.messageTs,
          limit: 100,
        },
      });

      if (!response.data.ok) {
        logger.error(
          `[IssuesService][getIssueThread] Slack API error: ${response.data.error}`
        );
        return {
          entries: [],
          persistedUpdates,
          threadUrl,
        };
      }

      const userCache = new Map<string, { name: string; avatar: string | null }>();
      const replies = (response.data.messages || [])
        .slice(1)
        .filter((message: any) => !message.bot_id && message.subtype !== "bot_message");

      const entries = await Promise.all(
        replies.map(async (message: any) => {
          let createdBy = "Slack User";
          let userAvatar: string | null = null;

          if (message.user) {
            if (userCache.has(message.user)) {
              const cached = userCache.get(message.user)!;
              createdBy = cached.name;
              userAvatar = cached.avatar;
            } else {
              try {
                const userResponse = await axios.get("https://slack.com/api/users.info", {
                  headers: {
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                  },
                  params: { user: message.user },
                });

                if (userResponse.data.ok && userResponse.data.user) {
                  const profile = userResponse.data.user.profile || {};
                  createdBy =
                    profile.display_name ||
                    profile.real_name ||
                    userResponse.data.user.name ||
                    createdBy;
                  userAvatar = profile.image_48 || null;
                }
              } catch (error) {
                logger.warn(
                  `[IssuesService][getIssueThread] Failed to fetch Slack user ${message.user}: ${error}`
                );
              }

              userCache.set(message.user, {
                name: createdBy,
                avatar: userAvatar,
              });
            }
          }

          return {
            id: `slack_${message.ts}`,
            source: "slack",
            createdByUid: message.user || null,
            createdByDepartment: null,
            createdAt: new Date(parseFloat(message.ts) * 1000).toISOString(),
            createdBy,
            updatedAt: null,
            updatedBy: null,
            updates: message.text || "",
            deletedAt: null,
            deletedBy: null,
            userAvatar,
            fileInfo: Array.isArray(message.files)
              ? message.files.map((file: any, index: number) => this.buildSlackFileAttachment(file, message.ts, index))
              : [],
          };
        })
      );
      return {
        entries,
        persistedUpdates,
        threadUrl,
      };
    } catch (error) {
      logger.error(
        `[IssuesService][getIssueThread] Error fetching Slack thread for issue ${issueId}: ${error}`
      );
      return {
        entries: [],
        persistedUpdates,
        threadUrl: null,
      };
    }
  }

  async getIssueVendorThread(issueId: number, vendorThreadId?: string | number | null) {
    const issue = await this.issueRepo.findOne({
      where: { id: issueId },
    });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${issueId} not found`);
    }

    const trackedVendorThreads = await this.slackMessageRepo.find({
      where: {
        entityType: "issue-vendor-thread",
        entityId: issueId,
      },
      order: {
        updatedAt: "DESC",
      },
    });

    const requestedVendorThreadId = Number(vendorThreadId);
    const trackedVendorThread = Number.isFinite(requestedVendorThreadId)
      ? trackedVendorThreads.find((thread) => thread.id === requestedVendorThreadId) || trackedVendorThreads[0]
      : trackedVendorThreads[0];

    if (!trackedVendorThread) {
      return {
        attached: false,
        threadUrl: null,
        threads: [],
        entries: [],
      };
    }

    const threads = trackedVendorThreads.map((thread, index) => {
      let parsedOriginalMessage: any = {};
      try {
        parsedOriginalMessage = thread.originalMessage ? JSON.parse(thread.originalMessage) : {};
      } catch {
        parsedOriginalMessage = {};
      }

      return {
        id: thread.id,
        label: `Vendor Thread ${trackedVendorThreads.length - index}`,
        channel: thread.channel,
        threadTs: thread.threadTs || thread.messageTs,
        messageTs: thread.messageTs,
        threadUrl: parsedOriginalMessage?.slackLink || null,
        openPhone: parsedOriginalMessage?.openPhone || null,
      };
    });

    const parsedOriginalMessage = (() => {
      try {
        return trackedVendorThread.originalMessage ? JSON.parse(trackedVendorThread.originalMessage) : {};
      } catch {
        return {};
      }
    })();

    const threadUrl =
      parsedOriginalMessage?.slackLink ||
      (await this.getSlackThreadPermalink(trackedVendorThread.channel, trackedVendorThread.threadTs || trackedVendorThread.messageTs));

    try {
      const entries = await this.getSlackThreadEntries(
        trackedVendorThread.channel,
        trackedVendorThread.threadTs || trackedVendorThread.messageTs,
        true,
        true
      );

      return {
        attached: true,
        id: trackedVendorThread.id,
        channel: trackedVendorThread.channel,
        threadTs: trackedVendorThread.threadTs || trackedVendorThread.messageTs,
        messageTs: trackedVendorThread.messageTs,
        threadUrl,
        openPhone: parsedOriginalMessage?.openPhone || null,
        threads,
        entries,
      };
    } catch (error) {
      logger.error(`[IssuesService][getIssueVendorThread] Slack API error for issue ${issueId}: ${error}`);
      return {
        attached: true,
        id: trackedVendorThread.id,
        channel: trackedVendorThread.channel,
        threadTs: trackedVendorThread.threadTs || trackedVendorThread.messageTs,
        messageTs: trackedVendorThread.messageTs,
        threadUrl,
        openPhone: parsedOriginalMessage?.openPhone || null,
        threads,
        entries: [],
        error: "Unable to load vendor thread replies. Please confirm the Slack app can access the channel.",
      };
    }
  }

  async resolveIssueOpenPhoneConversation(issueId: number, phone?: string, contactName?: string) {
    const issue = await this.issueRepo.findOne({
      where: { id: issueId },
    });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${issueId} not found`);
    }

    const normalizedContactName = String(contactName || "").trim().toLowerCase();
    if (["ana", "diana"].includes(normalizedContactName)) {
      return {
        found: false,
        skipped: true,
        reason: "excluded_poc",
      };
    }

    const openPhoneService = new OpenPhoneService();
    const normalizedPhone = openPhoneService.formatPhoneNumber("+1", String(phone || ""));
    if (!normalizedPhone) {
      return {
        found: false,
        skipped: false,
        reason: "missing_phone",
      };
    }

    const result = await openPhoneService.findMessagesByParticipant(normalizedPhone, 50);
    const messages = Array.isArray(result?.data) ? result.data : [];
    if (!messages.length) {
      return {
        found: false,
        skipped: false,
        reason: "not_found",
        participant: normalizedPhone,
      };
    }

    const latestMessage: any = [...messages].sort((a: any, b: any) => {
      const aTime = new Date(a.createdAt || a.updatedAt || 0).getTime();
      const bTime = new Date(b.createdAt || b.updatedAt || 0).getTime();
      return bTime - aTime;
    })[0];
    const conversationId = latestMessage?.conversationId;
    const phoneNumberId = latestMessage?.phoneNumberId;

    return {
      found: Boolean(conversationId && phoneNumberId),
      skipped: false,
      participant: normalizedPhone,
      conversationId: conversationId || null,
      phoneNumberId: phoneNumberId || null,
      latestMessageAt: latestMessage?.createdAt || latestMessage?.updatedAt || null,
      url: conversationId && phoneNumberId ? `https://my.quo.com/inbox/${phoneNumberId}/c/${conversationId}` : null,
      source: "auto",
    };
  }

  async previewSlackThread(slackLink: string) {
    const parsedThread = this.parseSlackThreadLink(slackLink);
    const threadUrl =
      (await this.getSlackThreadPermalink(parsedThread.channel, parsedThread.threadTs)) ||
      parsedThread.url;
    const entries = await this.getSlackThreadEntries(parsedThread.channel, parsedThread.threadTs, true, true);

    return {
      attached: true,
      channel: parsedThread.channel,
      threadTs: parsedThread.threadTs,
      messageTs: parsedThread.messageTs,
      threadUrl,
      entries,
    };
  }

  async attachIssueVendorThread(
    issueId: number,
    slackLink: string,
    userId: string,
    createOptions?: { channel?: string; message?: string; openPhone?: { url?: string; conversationId?: string; phoneNumberId?: string; participant?: string; source?: string } | null; vendorThreadId?: string | number | null }
  ) {
    const issue = await this.issueRepo.findOne({
      where: { id: issueId },
    });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${issueId} not found`);
    }

    const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
    const userName = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "SecureStay";
    let parsedThread: { channel: string; threadTs: string; messageTs: string; url: string };
    const openPhone = createOptions?.openPhone?.url
      ? {
          ...this.parseOpenPhoneConversationLink(createOptions.openPhone.url),
          ...createOptions.openPhone,
        }
      : createOptions?.openPhone || null;

    if (createOptions?.channel && String(createOptions?.message || "").trim()) {
      const channel = String(createOptions.channel).trim();
      if (!/^[CGD][A-Z0-9]+$/.test(channel)) {
        throw CustomErrorHandler.validationError("Please select a valid Slack channel");
      }
      const trimmedMessage = String(createOptions.message || "").trim();
      const mainIssueThread = await this.getMainIssueSlackThread(issueId);
      const issueTicketUrl = mainIssueThread
        ? await this.getSlackThreadPermalink(mainIssueThread.channel, mainIssueThread.threadTs || mainIssueThread.messageTs)
        : null;
      const actionElements = [
        ...(issueTicketUrl ? [{
          type: "button",
          text: {
            type: "plain_text",
            text: "View Issue Ticket",
            emoji: true,
          },
          url: issueTicketUrl,
        }] : []),
        ...(openPhone?.url ? [{
          type: "button",
          text: {
            type: "plain_text",
            text: "OpenPhone Conversation",
            emoji: true,
          },
          url: openPhone.url,
        }] : []),
      ];
      const slackResponse = await sendSlackMessage({
        channel,
        text: formatSecureStayMarkdownForSlack(trimmedMessage),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: formatSecureStayMarkdownForSlack(trimmedMessage),
            },
          },
          ...(actionElements.length ? [{
            type: "actions",
            elements: actionElements,
          }] : []),
        ],
      });

      if (!slackResponse?.ok || !slackResponse?.ts) {
        throw CustomErrorHandler.validationError(`Slack message failed${slackResponse?.error ? `: ${slackResponse.error}` : ""}`);
      }

      const permalink = await this.getSlackThreadPermalink(slackResponse.channel || channel, slackResponse.ts);
      parsedThread = {
        channel: slackResponse.channel || channel,
        threadTs: slackResponse.ts,
        messageTs: slackResponse.ts,
        url: permalink || "",
      };
    } else {
      parsedThread = this.parseSlackThreadLink(slackLink);
    }

    const requestedVendorThreadId = Number(createOptions?.vendorThreadId);
    const existing = Number.isFinite(requestedVendorThreadId)
      ? await this.slackMessageRepo.findOne({
          where: {
            id: requestedVendorThreadId,
            entityType: "issue-vendor-thread",
            entityId: issueId,
          },
        })
      : null;

    const payload = {
      slackLink: parsedThread.url,
      attachedBy: userId,
      attachedByName: userName,
      attachedAt: new Date().toISOString(),
      createdFromSecureStay: Boolean(createOptions?.channel && String(createOptions?.message || "").trim()),
      openPhone,
    };

    const savedThread = await this.slackMessageRepo.save({
      ...(existing || {}),
      channel: parsedThread.channel,
      messageTs: parsedThread.messageTs,
      threadTs: parsedThread.threadTs,
      entityType: "issue-vendor-thread",
      entityId: issueId,
      originalMessage: JSON.stringify(payload),
    });

    const mainIssueThread = await this.getMainIssueSlackThread(issueId);

    if (mainIssueThread) {
      const threadReference = parsedThread.url || `Slack channel ${parsedThread.channel}, thread ${parsedThread.threadTs}`;
      await sendSlackMessage(
        {
          channel: mainIssueThread.channel,
          text: `🔹 *Vendor thread added by ${userName}:* ${threadReference}`,
        },
        mainIssueThread.threadTs || mainIssueThread.messageTs
      );
    }

    return {
      attached: true,
      id: savedThread.id,
      channel: savedThread.channel,
      threadTs: savedThread.threadTs,
      messageTs: savedThread.messageTs,
      threadUrl: parsedThread.url,
      openPhone,
      entries: [],
    };
  }

  async unlinkIssueVendorThread(issueId: number, userId: string, vendorThreadId?: string | number | null) {
    const issue = await this.issueRepo.findOne({
      where: { id: issueId },
    });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${issueId} not found`);
    }

    const requestedVendorThreadId = Number(vendorThreadId);
    const trackedVendorThread = await this.slackMessageRepo.findOne({
      where: {
        ...(Number.isFinite(requestedVendorThreadId) ? { id: requestedVendorThreadId } : {}),
        entityType: "issue-vendor-thread",
        entityId: issueId,
      },
      order: {
        updatedAt: "DESC",
      },
    });

    if (!trackedVendorThread) {
      return {
        attached: false,
        threadUrl: null,
        entries: [],
      };
    }

    const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
    const userName = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "SecureStay";

    try {
      await sendSlackMessage(
        {
          channel: trackedVendorThread.channel,
          text: `🔸 *Vendor thread unlinked from SecureStay issue by ${userName}.*`,
        },
        trackedVendorThread.threadTs || trackedVendorThread.messageTs
      );
    } catch (error) {
      logger.warn(`[IssuesService][unlinkIssueVendorThread] Failed to post unlink notice for issue ${issueId}: ${error}`);
    }

    await this.slackMessageRepo.remove(trackedVendorThread);

    const mainIssueThread = await this.getMainIssueSlackThread(issueId);
    if (mainIssueThread) {
      await sendSlackMessage(
        {
          channel: mainIssueThread.channel,
          text: `🔸 *Vendor thread unlinked by ${userName}.*`,
        },
        mainIssueThread.threadTs || mainIssueThread.messageTs
      );
    }

    return {
      attached: false,
      threadUrl: null,
      entries: [],
    };
  }

  async replyToIssueVendorThread(issueId: number, updates: string, userId: string, vendorThreadId?: string | number | null) {
    const trimmedUpdates = String(updates || "").trim();
    if (!trimmedUpdates) {
      throw CustomErrorHandler.validationError("Reply text is required");
    }

    const issue = await this.issueRepo.findOne({
      where: { id: issueId },
    });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${issueId} not found`);
    }

    const requestedVendorThreadId = Number(vendorThreadId);
    const trackedVendorThread = await this.slackMessageRepo.findOne({
      where: {
        ...(Number.isFinite(requestedVendorThreadId) ? { id: requestedVendorThreadId } : {}),
        entityType: "issue-vendor-thread",
        entityId: issueId,
      },
      order: {
        updatedAt: "DESC",
      },
    });

    if (!trackedVendorThread) {
      throw CustomErrorHandler.notFound("No vendor thread is attached to this issue");
    }

    const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
    const userName = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "SecureStay";
    const slackResponse = await sendSlackMessage(
      {
        channel: trackedVendorThread.channel,
        text: `*${userName}:*\n${formatSecureStayMarkdownForSlack(trimmedUpdates)}`,
      },
      trackedVendorThread.threadTs || trackedVendorThread.messageTs
    );

    if (!slackResponse?.ok) {
      throw CustomErrorHandler.validationError(`Slack reply failed${slackResponse?.error ? `: ${slackResponse.error}` : ""}`);
    }

    return {
      id: `vendor_slack_${slackResponse.ts}`,
      source: "securestay",
      createdByUid: userId,
      createdByDepartment: null,
      createdAt: new Date(parseFloat(slackResponse.ts) * 1000).toISOString(),
      createdBy: userName,
      updatedAt: null,
      updatedBy: null,
      updates: trimmedUpdates,
      deletedAt: null,
      deletedBy: null,
      userAvatar: null,
      slackMessageTs: slackResponse.ts,
      fileInfo: [],
    };
  }

  async bulkUpdateIssues(
    ids: number[],
    updateData: Partial<Issue>,
    userId: string
  ) {
    try {
      // Validate that all issues exist
      const existingIssues = await this.issueRepo.find({
        where: { id: In(ids) },
      });

      if (existingIssues.length !== ids.length) {
        const foundIds = existingIssues.map((issue) => issue.id);
        const missingIds = ids.filter((id) => !foundIds.includes(id));
        throw CustomErrorHandler.notFound(
          `Issues with IDs ${missingIds.join(", ")} not found`
        );
      }

      // Update all issues with the provided data
      const updatePromises = existingIssues.map(async (issue) => {
        // Only update fields that are provided in updateData
        if (updateData.status !== undefined) {
          issue.status = updateData.status;
          if (updateData.status === "Completed") {
            issue.completed_at = new Date();
            issue.completed_by = userId;
          } else {
            issue.completed_at = null;
            issue.completed_by = null;
          }
        }
        if (updateData.gr_status !== undefined) {
          issue.gr_status = updateData.gr_status;
          if (updateData.gr_status === "Completed") {
            issue.gr_completed_at = new Date();
            issue.gr_completed_by = userId;
          } else {
            issue.gr_completed_at = null;
            issue.gr_completed_by = null;
          }
        }
        if (updateData.category !== undefined) {
          issue.category = updateData.category;
        }
        if (updateData.urgency !== undefined) {
          issue.urgency = updateData.urgency;
        }
        if (updateData.assignee !== undefined) {
          issue.assignee = updateData.assignee;
        }
        if (updateData.due_date !== undefined) {
          issue.due_date = updateData.due_date;
        }
        if (updateData.ai_resolution_status !== undefined) {
          issue.ai_resolution_status = updateData.ai_resolution_status;
        }
        if (updateData.ai_guest_sentiment !== undefined) {
          issue.ai_guest_sentiment = updateData.ai_guest_sentiment;
        }
        if (updateData.issue_description !== undefined) {
          issue.issue_description = updateData.issue_description;
        }
        if (updateData.resolution !== undefined) {
          issue.resolution = updateData.resolution;
        }
        if (
          updateData.manager_feedback !== undefined &&
          String(issue.manager_feedback || "").trim() !== String(updateData.manager_feedback || "").trim()
        ) {
          issue.manager_feedback_updated_at = new Date();
          issue.manager_feedback_updated_by = userId;
        }
        if (updateData.claim_resolution_status !== undefined) {
          issue.claim_resolution_status = updateData.claim_resolution_status;
        }
        if (updateData.claim_resolution_amount !== undefined) {
          issue.claim_resolution_amount = updateData.claim_resolution_amount;
        }
        if (updateData.estimated_reasonable_price !== undefined) {
          issue.estimated_reasonable_price =
            updateData.estimated_reasonable_price;
        }
        if (updateData.final_price !== undefined) {
          issue.final_price = updateData.final_price;
        }
        if (updateData.owner_notes !== undefined) {
          issue.owner_notes = updateData.owner_notes;
        }
        if (updateData.manager_feedback !== undefined) {
          issue.manager_feedback = updateData.manager_feedback;
        }
        if (updateData.next_steps !== undefined) {
          issue.next_steps = updateData.next_steps;
        }
        if (updateData.listing_id !== undefined) {
          const listing_name =
            (
              await appDatabase.getRepository(Listing).findOne({
                where: { id: Number(updateData.listing_id) },
              })
            )?.internalListingName || "";
          issue.listing_id = updateData.listing_id;
          issue.listing_name = listing_name;
        }
        if (updateData.guest_name !== undefined) {
          issue.guest_name = updateData.guest_name;
        }
        if (updateData.guest_contact_number !== undefined) {
          issue.guest_contact_number = updateData.guest_contact_number;
        }
        if (updateData.channel !== undefined) {
          issue.channel = updateData.channel;
        }
        if (updateData.check_in_date !== undefined) {
          issue.check_in_date = updateData.check_in_date;
        }
        if (updateData.reservation_amount !== undefined) {
          issue.reservation_amount = updateData.reservation_amount;
        }
        if (updateData.reservation_id !== undefined) {
          issue.reservation_id = updateData.reservation_id;
        }
        if (updateData.date_time_reported !== undefined) {
          issue.date_time_reported = updateData.date_time_reported;
        }
        if (updateData.date_time_contractor_contacted !== undefined) {
          issue.date_time_contractor_contacted =
            updateData.date_time_contractor_contacted;
        }
        if (updateData.date_time_contractor_deployed !== undefined) {
          issue.date_time_contractor_deployed =
            updateData.date_time_contractor_deployed;
        }
        if (updateData.date_time_work_finished !== undefined) {
          issue.date_time_work_finished = updateData.date_time_work_finished;
        }
        if (updateData.final_contractor_name !== undefined) {
          issue.final_contractor_name = updateData.final_contractor_name;
        }

        issue.updated_by = userId;
        return this.issueRepo.save(issue);
      });

      const updatedIssues = await Promise.all(updatePromises);

      return {
        success: true,
        updatedCount: updatedIssues.length,
        message: `Successfully updated ${updatedIssues.length} issues`,
      };
    } catch (error) {
      throw error;
    }
  }

  async migrateFilesToDrive() {
    //get all issues
    const issues = await this.issueRepo.find();
    const fileInfo = await this.fileInfoRepo.find({
      where: { entityType: "issues" },
    });

    for (const issue of issues) {
      try {
        if (issue.fileNames) {
          const fileNames = JSON.parse(issue.fileNames) as string[];
          const filesForIssue = fileInfo.filter(
            (file) => file.entityId === issue.id
          );
          for (const file of fileNames) {
            const fileExists = filesForIssue.find((f) => f.fileName === file);
            if (!fileExists) {
              const fileRecord = new FileInfo();
              fileRecord.entityType = "issues";
              fileRecord.entityId = issue.id;
              fileRecord.fileName = file;
              fileRecord.createdBy = issue.created_by;
              fileRecord.localPath = `${process.cwd()}/dist/public/issues/${file}`;
              fileRecord.mimetype = null;
              fileRecord.originalName = null;
              await this.fileInfoRepo.save(fileRecord);
            }
          }
        }
      } catch (error) {
        logger.error(
          `Error migrating files for issue ID ${issue.id}: ${error.message}`
        );
      }
    }
  }

  async updateAssignee(id: number, assignee: string | null, userId: string) {
    const issue = await this.issueRepo.findOne({ where: { id } });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
    }
    issue.assignee = assignee || null;
    issue.updated_by = userId;
    return await this.issueRepo.save(issue);
  }

  async updateUrgency(id: number, urgency: number, userId: string) {
    const issue = await this.issueRepo.findOne({ where: { id } });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
    }
    issue.urgency = urgency;
    issue.updated_by = userId;
    return await this.issueRepo.save(issue);
  }

  async updateMistake(id: number, mistake: string, userId: string) {
    const issue = await this.issueRepo.findOne({ where: { id } });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
    }
    issue.mistake = mistake;
    if (mistake === "Resolved") {
      issue.mistakeResolvedOn = format(new Date(), "yyyy-MM-dd");
    } else {
      issue.mistakeResolvedOn = null;
    }
    issue.updated_by = userId;
    return await this.issueRepo.save(issue);
  }

  async updateStatus(id: number, status: string, userId: string, statusField: "ir" | "gr" = "ir") {
    const issue = await this.issueRepo.findOne({ where: { id } });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
    }
    if (statusField === "gr") {
      issue.gr_status = status;
      if (status === "Completed") {
        issue.gr_completed_at = new Date();
        issue.gr_completed_by = userId;
      } else {
        issue.gr_completed_at = null;
        issue.gr_completed_by = null;
      }
    } else {
      issue.status = status;
      if (status === "Completed") {
        issue.completed_at = new Date();
        issue.completed_by = userId;
      } else {
        issue.completed_at = null;
        issue.completed_by = null;
      }
    }
    issue.updated_by = userId;
    return await this.issueRepo.save(issue);
  }

  async generateAiSummary(issueId: number) {
    const issue = await this.issueRepo.findOne({ where: { id: issueId } });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${issueId} not found`);
    }

    const updated = await this.applyAiFields(issue, true);
    return {
      ai_short_title: updated.ai_short_title,
      ai_checklist: (() => {
        try {
          return updated.ai_checklist ? JSON.parse(updated.ai_checklist) : [];
        } catch {
          return [];
        }
      })(),
    };
  }

  private normalizeAiResolutionStatus(value: unknown) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "resolved") return "Resolved";
    if (normalized === "not resolved" || normalized === "unresolved") return "Not Resolved";
    return "—";
  }

  private normalizeAiGuestSentiment(value: unknown) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "positive") return "Positive";
    if (normalized === "mixed") return "Mixed";
    if (normalized === "neutral") return "Neutral";
    if (normalized === "negative") return "Negative";
    return "—";
  }

  private async getLatestResolutionSourceUpdateAt(issueId: number) {
    const latest = await this.issueUpdatesRepo
      .createQueryBuilder("update")
      .where("update.issueId = :issueId", { issueId })
      .andWhere("update.deletedAt IS NULL")
      .andWhere("COALESCE(update.source, 'securestay') <> :systemSource", { systemSource: "system" })
      .andWhere("TRIM(COALESCE(update.updates, '')) <> ''")
      .orderBy("update.createdAt", "DESC")
      .getOne();
    return latest?.createdAt || null;
  }

  private hasResolutionSourceUpdateSinceRefresh(issue: Issue, latestUpdateAt: Date | null) {
    if (!latestUpdateAt) return false;
    if (!issue.resolution_refreshed_at) return true;
    return new Date(latestUpdateAt).getTime() > new Date(issue.resolution_refreshed_at).getTime();
  }

  private async getIssueUserDisplayName(uid?: string | null) {
    if (!uid) return null;
    if (uid === "system") return "System";
    const user = await this.usersRepo.findOne({ where: { uid } });
    if (!user) return uid;
    const employee = await this.employeeRepo.findOne({
      where: { userId: user.id, deletedAt: null as any },
      select: ["preferredName"],
    });
    return String(employee?.preferredName || user.firstName || "").trim() || uid;
  }

  private async saveResolutionAnalysisRefresh(issue: Issue, values: {
    issueResolution: string;
    guestSentiment: string;
    resolution: string;
    guestRelationsResolution: string;
    managerAiFeedback: string;
  }) {
    const systemActor = "system";
    issue.ai_resolution_status = values.issueResolution;
    issue.ai_guest_sentiment = values.guestSentiment;
    issue.resolution = values.resolution;
    issue.guest_relations_resolution = values.guestRelationsResolution;
    issue.manager_ai_feedback = values.managerAiFeedback;
    issue.resolution_refreshed_at = new Date();
    issue.resolution_refreshed_by = systemActor;
    const saved = await this.issueRepo.save(issue);

    const update = this.issueUpdatesRepo.create({
      issue: saved,
      updates: "Resolution AI analysis refreshed.",
      createdBy: systemActor,
      source: "system",
    });
    await this.issueUpdatesRepo.save(update);

    return {
      issueResolution: saved.ai_resolution_status,
      guestSentiment: saved.ai_guest_sentiment,
      resolution: saved.resolution,
      guestRelationsResolution: saved.guest_relations_resolution,
      managerAiFeedback: saved.manager_ai_feedback,
      resolutionRefreshedAt: saved.resolution_refreshed_at,
      resolutionRefreshedBy: saved.resolution_refreshed_by,
      resolutionRefreshedByName: await this.getIssueUserDisplayName(saved.resolution_refreshed_by),
    };
  }

  async refreshResolutionAnalysisIfStale(issueId: number, userId?: string) {
    const issue = await this.issueRepo.findOne({ where: { id: issueId } });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${issueId} not found`);
    }

    const latestUpdateAt = await this.getLatestResolutionSourceUpdateAt(issueId);
    if (!this.hasResolutionSourceUpdateSinceRefresh(issue, latestUpdateAt)) {
      return {
        refreshed: false,
        latestUpdateAt,
        issueResolution: issue.ai_resolution_status,
        guestSentiment: issue.ai_guest_sentiment,
        resolution: issue.resolution,
        guestRelationsResolution: issue.guest_relations_resolution,
        managerAiFeedback: issue.manager_ai_feedback,
        resolutionRefreshedAt: issue.resolution_refreshed_at,
        resolutionRefreshedBy: issue.resolution_refreshed_by,
        resolutionRefreshedByName: await this.getIssueUserDisplayName(issue.resolution_refreshed_by),
      };
    }

    return {
      refreshed: true,
      latestUpdateAt,
      ...(await this.generateResolutionAnalysis(issueId, userId || "system")),
    };
  }

  async refreshStaleResolutionAnalyses() {
    const rows = await appDatabase.query(
      `
      SELECT i.id
      FROM issues i
      WHERE i.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM issues_updates u
          WHERE u.issueId = i.id
            AND u.deletedAt IS NULL
            AND COALESCE(u.source, 'securestay') <> 'system'
            AND TRIM(COALESCE(u.updates, '')) <> ''
            AND (i.resolution_refreshed_at IS NULL OR u.createdAt > i.resolution_refreshed_at)
        )
      ORDER BY i.id ASC
      `
    );

    let refreshed = 0;
    for (const row of rows || []) {
      try {
        await this.generateResolutionAnalysis(Number(row.id), "system");
        refreshed += 1;
      } catch (error) {
        logger.warn(`[IssuesService] Failed scheduled resolution refresh for issue ${row.id}: ${error}`);
      }
    }

    return { checked: rows?.length || 0, refreshed };
  }

  async generateResolutionAnalysis(issueId: number, _refreshedBy = "system") {
    const issue = await this.issueRepo.findOne({
      where: { id: issueId },
      relations: ["issueUpdates"],
    });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${issueId} not found`);
    }

    const userDirectory = await this.buildIssueUserDirectory();
    const userDirectoryByUid = new Map(userDirectory.map((user) => [user.uid, user]));

    const updates = (issue.issueUpdates || [])
      .filter((entry) => !entry.deletedAt && String(entry.updates || "").trim())
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
      .map((entry) => ({
        createdAt: entry.createdAt,
        source: entry.source || "securestay",
        createdBy: entry.createdBy || null,
        createdByName: userDirectoryByUid.get(entry.createdBy || "")?.preferredDisplayName || entry.createdBy || null,
        text: entry.updates,
      }));

    const fallback = {
      issueResolution: "—",
      guestSentiment: "—",
      resolution: "—",
      guestRelationsResolution: "—",
      managerAiFeedback: "—",
    };

    if (!this.openai || updates.length === 0) {
      return this.saveResolutionAnalysisRefresh(issue, fallback);
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Analyze an internal issue ticket activity timeline. Return only valid JSON with keys issueResolution, guestSentiment, issueResolutionSummary, guestRelationSummary, managerAssessment. issueResolution must be one of Resolved, Not Resolved, or —. guestSentiment must be one of Positive, Mixed, Neutral, Negative, or —. issueResolutionSummary should focus on maintenance/issue-resolution handling. guestRelationSummary should focus on guest-relations handling. managerAssessment should assess how the involved reps handled the ticket, including strengths, misses, and follow-up quality. Mention reps using the createdByName value only; this is their preferred name when available, otherwise their first name. Do not use full names unless createdByName is a full name because no preferred/first name was available. If evidence is missing, use —. Keep each summary concise and factual.",
          },
          {
            role: "user",
            content: JSON.stringify({
              category: issue.category || null,
              description: issue.issue_description || "",
              currentIssueResolutionNotes: issue.resolution || "",
              currentGuestRelationsResolutionNotes: issue.guest_relations_resolution || "",
              currentManagerAiFeedback: issue.manager_ai_feedback || "",
              updates,
            }),
          },
        ],
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) throw new Error("No AI response");

      const parsed = JSON.parse(content);
      const issueResolution = this.normalizeAiResolutionStatus(parsed?.issueResolution);
      const guestSentiment = this.normalizeAiGuestSentiment(parsed?.guestSentiment);
      const issueResolutionSummary = String(parsed?.issueResolutionSummary || "—").trim() || "—";
      const guestRelationSummary = String(parsed?.guestRelationSummary || "—").trim() || "—";
      const managerAssessment = String(parsed?.managerAssessment || "—").trim() || "—";

      return this.saveResolutionAnalysisRefresh(issue, {
        issueResolution,
        guestSentiment,
        resolution: issueResolutionSummary,
        guestRelationsResolution: guestRelationSummary,
        managerAiFeedback: managerAssessment,
      });
    } catch (error) {
      logger.warn(`[IssuesService] Failed to generate resolution analysis: ${error}`);
      return this.saveResolutionAnalysisRefresh(issue, fallback);
    }
  }

  async runQuickAction(id: number, action: string, userId: string) {
    const issue = await this.issueRepo.findOne({ where: { id } });
    if (!issue) {
      throw CustomErrorHandler.notFound(`Issue with ID ${id} not found`);
    }

    const userDirectory = await this.buildIssueUserDirectory();
    const actor = userDirectory.find((item) => item.uid === userId);
    const actorName = actor?.name || "SecureStay";

    const messages: Record<string, string> = {
      assign_to_myself: `${actorName} assigned this issue to themselves.`,
      coordinating_guest: `${actorName} is coordinating with the guest and will follow up with an update.`,
      coordinating_vendor: `${actorName} is coordinating with the vendor and confirming schedule details.`,
      escalate_issue: `${actorName} escalated this issue and requested manager help from Anj.`,
    };

    if (action === "assign_to_myself") {
      issue.assignee = userId;
    }

    if (action === "escalate_issue") {
      issue.status = "Need Help";
    }

    issue.updated_by = userId;
    const updatedIssue = await this.issueRepo.save(issue);

    const update = this.issueUpdatesRepo.create({
      issue: updatedIssue,
      updates: messages[action] || `${actorName} updated this issue.`,
      createdBy: userId,
    });

    const savedUpdate = await this.issueUpdatesRepo.save(update);

    return {
      issue: updatedIssue,
      update: {
        ...savedUpdate,
        source: "securestay",
        createdByUid: userId,
        createdByDepartment: actor?.department || null,
        createdBy: actorName,
        userAvatar: actor?.avatarUrl || null,
      },
    };
  }
}
