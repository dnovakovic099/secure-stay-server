import { NextFunction, Request, Response } from "express";
import { IssuesService } from "../services/IssuesService";
import { IssueAIService } from "../services/IssueAIService";
import { downloadUrlsAsIssueFiles } from "../services/AITicketCreationHelpers";
import path from "path";
import fs from "fs";

const UPLOADS_PATH = path.join(process.cwd(), "public/issues");

const parseIssueFileNames = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((fileName): fileName is string => typeof fileName === "string" && fileName.length > 0);
  }

  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((fileName): fileName is string => typeof fileName === "string" && fileName.length > 0)
      : [];
  } catch {
    return [];
  }
};

const getIssueAttachmentFiles = (request: any): Express.Multer.File[] => {
  const attachments = request.files?.["attachments"];
  return Array.isArray(attachments) ? attachments : [];
};

export class IssuesController {
  async getIssues(request: Request, response: Response) {
    const issuesService = new IssuesService();
    try {
      const page = parseInt(request.query.page as string) || 1;
      const limit = parseInt(request.query.limit as string) || 10;
      const fromDate = (request.query.fromDate as string) || "";
      const toDate = (request.query.toDate as string) || "";
      const status = (request.query.status as string) || "";
      const listingId = (request.query.listingId as string) || "";
      const isClaimOnly = request.query.isClaimOnly === "true";
      const claimAmount = request.query.claimAmount as string;
      const guestName = request.query.guestName as string;
      const issueIds = request.query.issueIds as string;
      const reservationId = request.query.reservationId as string;

      const result = await issuesService.getIssues(
        page,
        limit,
        fromDate,
        toDate,
        status,
        listingId,
        isClaimOnly,
        claimAmount,
        guestName,
        issueIds,
        reservationId
      );

      return response.send({
        status: true,
        ...result,
      });
    } catch (error) {
      return response.send({
        status: false,
        message: error.message,
      });
    }
  }

  async getUnresolvedIssues(request: Request, response: Response) {
    const issuesService = new IssuesService();
    const listingId = (request.query.listingId as string) || "";
    const issues = await issuesService.getIssuesByListingId(listingId);
    return response.json({
      status: true,
      data: issues,
    });
  }

  async createIssue(request: any, response: Response) {
    const issuesService = new IssuesService();
    try {
      const userId = request.user.id;

      let fileInfo:
        | {
            fileName: string;
            filePath: string;
            mimeType: string;
            originalName: string;
          }[]
        | null = null;

      const uploadedAttachments = getIssueAttachmentFiles(request);
      if (uploadedAttachments.length > 0) {
        fileInfo = uploadedAttachments.map((file) => {
          return {
            fileName: file.filename,
            filePath: file.path,
            mimeType: file.mimetype,
            originalName: file.originalname,
          };
        });
      }

      // Optional remote guest photo URLs (e.g. Inbox V2 message attachments).
      const remoteUrls = Array.isArray(request.body?.attachmentUrls)
        ? request.body.attachmentUrls.map(String)
        : typeof request.body?.attachmentUrls === "string"
          ? (() => {
              try {
                const parsed = JSON.parse(request.body.attachmentUrls);
                return Array.isArray(parsed) ? parsed.map(String) : [];
              } catch {
                return String(request.body.attachmentUrls)
                  .split(/[\n,]+/)
                  .map((s: string) => s.trim())
                  .filter(Boolean);
              }
            })()
          : [];
      if (remoteUrls.length) {
        const downloaded = await downloadUrlsAsIssueFiles(remoteUrls);
        fileInfo = [...(fileInfo || []), ...downloaded];
      }

      // Strip non-column fields before create.
      const body = { ...request.body };
      delete body.attachmentUrls;

      const result = await issuesService.createIssue(
        body,
        userId,
        fileInfo
      );
      return response.status(201).json({
        status: true,
        data: result,
      });
    } catch (error) {
      return response.status(400).json({
        status: false,
        message: error.message,
      });
    }
  }

  async updateIssue(request: any, response: Response) {
    const issuesService = new IssuesService();
    try {
      const id = parseInt(request.params.id);
      const userId = request.user.id;

      // Get current issue
      const currentIssue = await issuesService.getIssueById(id);
      const currentFiles = parseIssueFileNames(currentIssue.fileNames);

      // Process deleted files
      const deletedFiles = JSON.parse(request.body.deletedFiles || "[]");

      // Delete files physically
      for (const fileName of deletedFiles) {
        const filePath = path.join(UPLOADS_PATH, fileName);
        try {
          await fs.promises.unlink(filePath);
        } catch (err) {
          console.error(`Failed to delete file ${fileName}:`, err);
        }
      }

      // Update file list, removing deleted files
      const updatedFiles = currentFiles.filter(
        (file) => !deletedFiles.includes(file)
      );

      // Add new files if they exist

      let fileInfo:
        | {
            fileName: string;
            filePath: string;
            mimeType: string;
            originalName: string;
          }[]
        | null = null;

      const uploadedAttachments = getIssueAttachmentFiles(request);
      if (uploadedAttachments.length > 0) {
        fileInfo = uploadedAttachments.map((file) => {
          return {
            fileName: file.filename,
            filePath: file.path,
            mimeType: file.mimetype,
            originalName: file.originalname,
          };
        });
      }
      // Combine existing and new files
      const finalFileNames = [
        ...updatedFiles,
        ...(fileInfo ? fileInfo.map((file) => file.fileName) : []),
      ];
      // Update issue data with new file list
      const result = await issuesService.updateIssue(
        id,
        {
          ...request.body,
          fileNames: JSON.stringify(finalFileNames),
        },
        userId,
        fileInfo
      );

      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      return response.status(400).json({
        status: false,
        message: error.message,
      });
    }
  }

  async deleteIssue(request: any, response: Response, next: NextFunction) {
    try {
      const { id } = request.params;
      const userId = request.user.id;

      const issuesService = new IssuesService();
      await issuesService.deleteIssue(Number(id), userId);

      return response.send({
        status: true,
        message: "Issue deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async exportIssuesToExcel(request: Request, response: Response) {
    try {
      const userId = (request as any).user.id; // Assuming you have user info in req.user
      const toArray = (value: any) =>
        value === undefined || value === null || value === ""
          ? undefined
          : Array.isArray(value)
          ? value
          : [value];
      const {
        fromDate,
        toDate,
        status,
        grStatus,
        listingId,
        isClaimOnly,
        claimAmount,
        guestName,
        propertyType,
        serviceType,
        keyword,
        keywordField,
        channel,
        category,
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
        resolutionNotesStatus,
        resolutionNotesKeyword,
        managerNotesStatus,
        managerNotesKeyword,
      } = request.query;

      const filters = {
        fromDate: fromDate as string,
        toDate: toDate as string,
        status: toArray(status) as string[] | undefined,
        grStatus: toArray(grStatus) as string[] | undefined,
        listingId: toArray(listingId) as string[] | undefined,
        isClaimOnly: isClaimOnly === "true",
        claimAmount: claimAmount as string,
        guestName: guestName as string,
        propertyType: toArray(propertyType) as string[] | undefined,
        serviceType: toArray(serviceType) as string[] | undefined,
        keyword: keyword as string,
        keywordField: keywordField as string,
        channel: toArray(channel) as string[] | undefined,
        category: toArray(category) as string[] | undefined,
        dateType: dateType as string,
        stayStatus: toArray(stayStatus) as string[] | undefined,
        assignee: toArray(assignee) as string[] | undefined,
        urgency: toArray(urgency) as string[] | undefined,
        activityType: activityType as string,
        activityUser: toArray(activityUser) as string[] | undefined,
        activityFromDate: activityFromDate as string,
        activityToDate: activityToDate as string,
        updateSource: updateSource as string,
        activityKeyword: activityKeyword as string,
        vendorThreadStatus: vendorThreadStatus as string,
        issueResolution: issueResolution as string,
        guestSentiment: guestSentiment as string,
        resolutionNotesStatus: resolutionNotesStatus as string,
        resolutionNotesKeyword: resolutionNotesKeyword as string,
        managerNotesStatus: managerNotesStatus as string,
        managerNotesKeyword: managerNotesKeyword as string,
        userId: userId,
      };

      const issuesService = new IssuesService();
      const csvBuffer = await issuesService.exportIssuesToExcel(filters);

      response.setHeader("Content-Type", "text/csv");
      response.setHeader(
        "Content-Disposition",
        "attachment; filename=issues_export.csv"
      );
      response.send(csvBuffer);
    } catch (error) {
      return response.status(500).json({ error: "Failed to export issues" });
    }
  }

  async getIssuesByReservationId(
    request: Request,
    response: Response,
    next: NextFunction
  ) {
    try {
      const reservationId = request.params.reservationId;
      const issuesService = new IssuesService();
      const issues = await issuesService.getIssuesByReservationId(
        reservationId
      );
      return response.json({
        status: true,
        data: issues,
      });
    } catch (error) {
      return next(error);
    }
  }

  // Batch endpoint: fetches issues for multiple reservation IDs in one DB query.
  // GET /issues/by-reservations?ids=123,456,789
  async getIssuesByReservationIds(
    request: Request,
    response: Response,
    next: NextFunction
  ) {
    try {
      const idsParam = String(request.query.ids || "");
      const reservationIds = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (reservationIds.length === 0) {
        return response.json({ status: true, data: {} });
      }
      const issuesService = new IssuesService();
      const grouped = await issuesService.getIssuesByReservationIds(reservationIds);
      return response.json({ status: true, data: grouped });
    } catch (error) {
      return next(error);
    }
  }

  async getAttachment(request: any, response: Response) {
    try {
      const fileName = request.params.fileName;
      const filePath = path.join(process.cwd(), "public/issues", fileName);

      // Check if file exists
      try {
        await fs.promises.access(filePath);
      } catch {
        return response.status(404).json({
          status: false,
          message: "File not found",
        });
      }

      // Send file
      return response.sendFile(filePath);
    } catch (error) {
      return response.status(400).json({
        status: false,
        message: error.message,
      });
    }
  }

  async migrateIssuesToActionItems(
    request: any,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userId = request.user.id;
      const issuesService = new IssuesService();
      const result = await issuesService.migrateIssueToActionItems(
        request.body,
        userId
      );
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async createIssueUpdates(
    request: any,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userId = request.user.id;
      const issuesService = new IssuesService();

      let fileInfo:
        | {
            fileName: string;
            filePath: string;
            mimeType: string;
            originalName: string;
          }[]
        | null = null;

      if (
        Array.isArray(request.files?.["attachments"]) &&
        request.files["attachments"].length > 0
      ) {
        fileInfo = (request.files["attachments"] as Express.Multer.File[]).map(
          (file) => ({
            fileName: file.filename,
            filePath: file.path,
            mimeType: file.mimetype,
            originalName: file.originalname,
          })
        );
      }

      const result = await issuesService.createIssueUpdates(
        request.body,
        userId,
        fileInfo || undefined
      );
      return response.status(201).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateIssueUpdates(
    request: any,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userId = request.user.id;
      const issuesService = new IssuesService();
      const result = await issuesService.updateIssueUpdates(
        request.body,
        userId
      );
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteIssueUpdates(
    request: any,
    response: Response,
    next: NextFunction
  ) {
    try {
      const userId = request.user.id;
      const issuesService = new IssuesService();
      const result = await issuesService.deleteIssueUpdates(
        request.params.id,
        userId
      );
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getGuestIssues(request: any, response: Response, next: NextFunction) {
    try {
      const userId = request.user.id;
      const issuesService = new IssuesService();
      const { issues, total, assigneeList } = await issuesService.getGuestIssues(
        request.query,
        userId
      );
      return response.status(200).json({
        status: true,
        data: issues,
        total,
        assigneeList,
      });
    } catch (error) {
      next(error);
    }
  }

  async getIssueThread(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const issuesService = new IssuesService();
      const result = await issuesService.getIssueThread(issueId);
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getIssueVendorThread(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const issuesService = new IssuesService();
      const result = await issuesService.getIssueVendorThread(issueId, request.query?.vendorThreadId);
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async previewSlackThread(request: any, response: Response, next: NextFunction) {
    try {
      const issuesService = new IssuesService();
      const result = await issuesService.previewSlackThread(String(request.query?.slackLink || ""));
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async proxySlackFile(request: any, response: Response, next: NextFunction) {
    try {
      const issuesService = new IssuesService();
      const slackResponse = await issuesService.proxySlackFile(String(request.query?.url || ""));
      const contentType = slackResponse.headers["content-type"] || "application/octet-stream";
      const contentLength = slackResponse.headers["content-length"];
      response.setHeader("Content-Type", contentType);
      if (contentLength) {
        response.setHeader("Content-Length", contentLength);
      }
      response.setHeader("Cache-Control", "private, max-age=300");
      slackResponse.data.pipe(response);
    } catch (error) {
      next(error);
    }
  }

  async attachIssueVendorThread(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const userId = request.user.id;
      const issuesService = new IssuesService();
      const result = await issuesService.attachIssueVendorThread(issueId, request.body?.slackLink, userId, {
        channel: request.body?.channel,
        message: request.body?.message,
        openPhone: request.body?.openPhone,
        vendorThreadId: request.body?.vendorThreadId,
      });
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async unlinkIssueVendorThread(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const userId = request.user.id;
      const issuesService = new IssuesService();
      const result = await issuesService.unlinkIssueVendorThread(issueId, userId, request.query?.vendorThreadId);
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async resolveIssueOpenPhoneConversation(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const issuesService = new IssuesService();
      const result = await issuesService.resolveIssueOpenPhoneConversation(
        issueId,
        request.query?.phone as string,
        request.query?.contactName as string
      );
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async replyToIssueVendorThread(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const userId = request.user.id;
      const issuesService = new IssuesService();
      const result = await issuesService.replyToIssueVendorThread(issueId, request.body?.updates, userId, request.body?.vendorThreadId);
      return response.status(201).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async generateAiSummary(
    request: any,
    response: Response,
    next: NextFunction
  ) {
    try {
      const issueId = Number(request.params.id);
      const issuesService = new IssuesService();
      const result = await issuesService.generateAiSummary(issueId);
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async generateResolutionAnalysis(
    request: any,
    response: Response,
    next: NextFunction
  ) {
    try {
      const issueId = Number(request.params.id);
      const userId = request.user.id;
      const issuesService = new IssuesService();
      const result = await issuesService.generateResolutionAnalysis(issueId, userId);
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async refreshResolutionAnalysisIfStale(
    request: any,
    response: Response,
    next: NextFunction
  ) {
    try {
      const issueId = Number(request.params.id);
      const userId = request.user.id;
      const issuesService = new IssuesService();
      const result = await issuesService.refreshResolutionAnalysisIfStale(issueId, userId);
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /** IR Copilot: get latest playbook suggestion (no regenerate). */
  async getIrSuggestion(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      if (!Number.isFinite(issueId)) {
        return response.status(400).json({ status: false, message: "Invalid issue id" });
      }
      const data = await new IssueAIService().getLatestSuggestion(issueId);
      return response.status(200).json({ status: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** IR Copilot: generate (or return recent) suggestion + ranked contacts. */
  async suggestIrCopilot(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      if (!Number.isFinite(issueId)) {
        return response.status(400).json({ status: false, message: "Invalid issue id" });
      }
      const force = request.body?.force === true || request.query?.force === "true";
      const data = await new IssueAIService().suggest(issueId, { force });
      return response.status(200).json({ status: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** IR Copilot: structured thumbs / categories / corrected playbook feedback. */
  async irCopilotFeedback(request: any, response: Response, next: NextFunction) {
    try {
      const body = request.body || {};
      const userId = Number(request.user?.secureStayUserId ?? request.user?.id) || null;
      const data = await new IssueAIService().submitFeedback({
        suggestionId: body.suggestionId != null ? Number(body.suggestionId) : null,
        issueId: body.issueId != null ? Number(body.issueId) : Number(request.params.id) || null,
        userId,
        rating: body.rating === "up" || body.rating === "down" ? body.rating : null,
        categories: Array.isArray(body.categories) ? body.categories.map(String) : [],
        feedbackText: body.feedbackText ?? body.feedback_text ?? null,
        correctedResponse: body.correctedResponse ?? body.corrected_response ?? null,
      });
      return response.status(201).json({ status: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** IR Copilot Phase 2: send edited guest draft via Inbox (Hostify). */
  async irSendGuestDraft(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const body = String(request.body?.body || request.body?.message || "").trim();
      const data = await new IssueAIService().sendGuestDraft(issueId, body, request.user);
      return response.status(200).json({ status: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** IR Copilot Phase 2: send SMS via Quo when a thread exists (else deep-link). */
  async irSendSmsDraft(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const body = String(request.body?.body || request.body?.message || "").trim();
      const data = await new IssueAIService().sendSmsDraft(issueId, body, {
        phone: request.body?.phone ?? null,
        user: request.user,
        target: request.body?.target === "vendor" ? "vendor" : "guest",
      });
      return response.status(200).json({ status: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** IR Copilot Phase 2: log internal note onto the ticket. */
  async irLogNote(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const note = String(request.body?.note || request.body?.body || "").trim();
      const userId = String(request.user?.id || "system");
      const data = await new IssueAIService().logInternalNote(issueId, note, userId);
      return response.status(201).json({ status: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** IR Copilot Phase 2: set nextUpdateDate follow-up. */
  async irScheduleFollowUp(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const data = await new IssueAIService().scheduleFollowUp(issueId, {
        hours: request.body?.hours != null ? Number(request.body.hours) : undefined,
        nextUpdateDate: request.body?.nextUpdateDate ?? null,
        note: request.body?.note ?? null,
        userId: String(request.user?.id || "system"),
      });
      return response.status(200).json({ status: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** IR Copilot: teach portfolio vendor memory (name + phone) and regenerate. */
  async irTeachVendor(request: any, response: Response, next: NextFunction) {
    try {
      const issueId = Number(request.params.id);
      const body = request.body || {};
      const data = await new IssueAIService().teachVendor(issueId, {
        name: String(body.name || "").trim(),
        phone: body.phone != null ? String(body.phone) : null,
        email: body.email != null ? String(body.email) : null,
        notes: body.notes != null ? String(body.notes) : null,
      });
      return response.status(200).json({ status: true, data });
    } catch (error) {
      next(error);
    }
  }

  async bulkUpdateIssues(request: any, response: Response, next: NextFunction) {
    try {
      const { ids, updateData } = request.body;
      const userId = request.user.id;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return response.status(400).json({
          status: false,
          message: "IDs array is required and must not be empty",
        });
      }

      if (!updateData || Object.keys(updateData).length === 0) {
        return response.status(400).json({
          status: false,
          message: "Update data is required and must not be empty",
        });
      }

      const issuesService = new IssuesService();
      const result = await issuesService.bulkUpdateIssues(
        ids,
        updateData,
        userId
      );

      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async migrateFilesToDrive(
    request: any,
    response: Response,
    next: NextFunction
  ) {
    try {
      const issuesService = new IssuesService();
      const result = await issuesService.migrateFilesToDrive();
      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateAssignee(request: any, response: Response, next: NextFunction) {
    try {
      const { id, assignee } = request.body;
      const userId = request.user.id;

      const issuesService = new IssuesService();
      const result = await issuesService.updateAssignee(id, assignee, userId);

      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUrgency(request: any, response: Response, next: NextFunction) {
    try {
      const { id, urgency } = request.body;
      const userId = request.user.id;

      const issuesService = new IssuesService();
      const result = await issuesService.updateUrgency(id, urgency, userId);

      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateMistake(request: any, response: Response, next: NextFunction) {
    try {
      const { id, mistake } = request.body;
      const userId = request.user.id;

      const issuesService = new IssuesService();
      const result = await issuesService.updateMistake(id, mistake, userId);

      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(request: any, response: Response, next: NextFunction) {
    try {
      const { id, status, statusField } = request.body;
      const userId = request.user.id;

      const issuesService = new IssuesService();
      const result = await issuesService.updateStatus(id, status, userId, statusField);

      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async quickAction(request: any, response: Response, next: NextFunction) {
    try {
      const { id, action } = request.body;
      const userId = request.user.id;
      const issuesService = new IssuesService();
      const result = await issuesService.runQuickAction(Number(id), action, userId);

      return response.status(200).json({
        status: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
