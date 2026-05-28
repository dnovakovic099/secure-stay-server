import axios from "axios";
import { format, subDays } from "date-fns";
import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { Claim } from "../entity/Claim";
import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { UsersEntity } from "../entity/Users";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { ClaimDiscussionAttachment, ClaimDiscussionMessageEntity } from "../entity/ClaimDiscussionMessage";
import { ClaimActivityLogEntity } from "../entity/ClaimActivityLog";
import { FileInfo } from "../entity/FileInfo";
import CustomErrorHandler from "../middleware/customError.middleware";
import { buildClaimSlackMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import { SlackMessageService } from "./SlackMessageService";
import { generateSlackMessageLink } from "../helpers/helpers";
import OpenAI from "openai";

type LegacyClaimStatus = "Not Submitted" | "In Progress" | "Submitted" | "Resolved" | "Denied";

interface ClaimEntryAsset {
    id: string;
    fileName: string;
    originalName: string;
    mimeType: string;
    size: number;
    capturedAt: string;
    url: string;
}

interface ClaimEntry {
    id: string;
    category: string;
    details: string;
    amount: number;
    photos: ClaimEntryAsset[];
    invoice: ClaimEntryAsset | null;
}

interface ClaimRequestData {
    statusGroup: string;
    statusDetail: string;
    reportedByType: string;
    reportedByCustom: string | null;
    submittedByName: string;
    payoutToType: string;
    payoutToCustom: string | null;
    totalRequestAmount: number;
    inputMode: "rows" | "shared";
    sharedDescription: string;
    sharedCategories: string[];
    sharedPhotos: ClaimEntryAsset[];
    sharedInvoice: ClaimEntryAsset | null;
    aiSuggestions: Array<Partial<ClaimEntry>>;
    entries: ClaimEntry[];
}

interface SecurityDepositData {
    status: "Captured" | "Not Authorized" | "Authorized" | "N/A";
    amountAuthorized: number | null;
    amountCaptured: number | null;
    notes: string;
}

interface ClaimResolutionRow {
    id: string;
    filedAmount: number;
    amountReceived: number;
    notes: string;
    source?: "manual" | "security_deposit";
}

interface ClaimPayoutData {
    status: "Not Received" | "Received" | "No Payout";
    payee: string;
    payoutAmount: number | null;
    notes: string;
}

interface ClaimReservationSnapshot {
    listingId: number | null;
    listingName: string | null;
    propertyType: string | null;
    guestName: string | null;
    checkInDate: string | null;
    checkOutDate: string | null;
    channel: string | null;
    confirmationNumber: string | null;
    reservationId: string | null;
    reservationLink: string | null;
    guestEmail: string | null;
    guestPhone: string | null;
    integration: string | null;
}

interface ClaimWorkspaceData {
    reservation: ClaimReservationSnapshot;
    claimRequest: ClaimRequestData;
    securityDeposit: SecurityDepositData;
    resolutions: ClaimResolutionRow[];
    payout: ClaimPayoutData;
}

interface AttachmentManifestItem {
    clientKey: string;
    section: "entry-photo" | "entry-invoice" | "shared-photo" | "shared-invoice";
    entryId?: string | null;
    capturedAt?: string | null;
}

const DEFAULT_STATUS_GROUP = "New";
const DEFAULT_STATUS_DETAIL = "New";

const DEFAULT_WORKSPACE_DATA = (submittedByName = "SecureStay User"): ClaimWorkspaceData => ({
    reservation: {
        listingId: null,
        listingName: null,
        propertyType: null,
        guestName: null,
        checkInDate: null,
        checkOutDate: null,
        channel: null,
        confirmationNumber: null,
        reservationId: null,
        reservationLink: null,
        guestEmail: null,
        guestPhone: null,
        integration: null,
    },
    claimRequest: {
        statusGroup: DEFAULT_STATUS_GROUP,
        statusDetail: DEFAULT_STATUS_DETAIL,
        reportedByType: "Cleaner",
        reportedByCustom: null,
        submittedByName,
        payoutToType: "Owner",
        payoutToCustom: null,
        totalRequestAmount: 0,
        inputMode: "rows",
        sharedDescription: "",
        sharedCategories: [],
        sharedPhotos: [],
        sharedInvoice: null,
        aiSuggestions: [],
        entries: Array.from({ length: 3 }).map((_, index) => ({
            id: `entry-${index + 1}`,
            category: "Damage",
            details: "",
            amount: 0,
            photos: [],
            invoice: null,
        })),
    },
    securityDeposit: {
        status: "N/A",
        amountAuthorized: null,
        amountCaptured: null,
        notes: "",
    },
    resolutions: [],
    payout: {
        status: "Not Received",
        payee: "Owner",
        payoutAmount: null,
        notes: "",
    },
});

export class ClaimWorkspaceService {
    private claimRepo = appDatabase.getRepository(Claim);
    private listingRepo = appDatabase.getRepository(Listing);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private userRepo = appDatabase.getRepository(UsersEntity);
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private discussionRepo = appDatabase.getRepository(ClaimDiscussionMessageEntity);
    private activityRepo = appDatabase.getRepository(ClaimActivityLogEntity);
    private fileInfoRepo = appDatabase.getRepository(FileInfo);
    private schemaReady: Promise<void> | null = null;

    private async ensureSchema() {
        if (!this.schemaReady) {
            this.schemaReady = (async () => {
                await appDatabase.query(`
                    ALTER TABLE claims
                    ADD COLUMN IF NOT EXISTS workspace_data LONGTEXT NULL
                `);
                await appDatabase.query(`
                    CREATE TABLE IF NOT EXISTS claim_discussion_messages (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        claim_id INT NOT NULL,
                        parent_message_id INT NULL,
                        source_type VARCHAR(20) NOT NULL,
                        author_id VARCHAR(100) NULL,
                        author_name VARCHAR(255) NOT NULL,
                        author_avatar VARCHAR(500) NULL,
                        content TEXT NOT NULL,
                        mentions JSON NULL,
                        metadata JSON NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        INDEX idx_claim_discussion_claim (claim_id),
                        INDEX idx_claim_discussion_parent (parent_message_id)
                    )
                `);
                await appDatabase.query(`
                    CREATE TABLE IF NOT EXISTS claim_activity_logs (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        claim_id INT NOT NULL,
                        type VARCHAR(30) NOT NULL,
                        actor_id VARCHAR(100) NULL,
                        actor_name VARCHAR(255) NULL,
                        title VARCHAR(255) NULL,
                        content TEXT NOT NULL,
                        metadata JSON NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_claim_activity_claim (claim_id)
                    )
                `);
            })();
        }
        await this.schemaReady;
    }

    private parseWorkspaceData(raw: string | null | undefined, submittedByName?: string | null): ClaimWorkspaceData {
        const fallback = DEFAULT_WORKSPACE_DATA(submittedByName || "SecureStay User");
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return {
                ...fallback,
                ...parsed,
                reservation: { ...fallback.reservation, ...(parsed?.reservation || {}) },
                claimRequest: { ...fallback.claimRequest, ...(parsed?.claimRequest || {}) },
                securityDeposit: { ...fallback.securityDeposit, ...(parsed?.securityDeposit || {}) },
                resolutions: Array.isArray(parsed?.resolutions) ? parsed.resolutions : fallback.resolutions,
                payout: { ...fallback.payout, ...(parsed?.payout || {}) },
            };
        } catch {
            return fallback;
        }
    }

    private getBaseUrl() {
        const configuredBaseUrl = String(process.env.BASE_URL || "").trim();
        return (
            configuredBaseUrl && !/localhost|127\.0\.0\.1/i.test(configuredBaseUrl)
                ? configuredBaseUrl
                : "https://securestay.ai"
        ).replace(/\/$/, "");
    }

    private buildAttachmentUrl(fileName: string) {
        return `${this.getBaseUrl()}/claims/attachment/${encodeURIComponent(fileName)}`;
    }

    private numberValue(value: any, fallback = 0) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    }

    private getLegacyStatus(group: string, detail: string): LegacyClaimStatus {
        if (group === "Submitted") return "Submitted";
        if (group === "Closed") {
            return detail === "Denied" || detail === "Appeal Denied" ? "Denied" : "Resolved";
        }
        return "In Progress";
    }

    private getVisibleStatus(workspace: ClaimWorkspaceData) {
        if (!workspace.claimRequest?.statusGroup) return DEFAULT_STATUS_DETAIL;
        if (workspace.claimRequest.statusGroup === "New") return "New";
        return workspace.claimRequest.statusDetail || workspace.claimRequest.statusGroup;
    }

    private applyResolutionAndPayoutSync(workspace: ClaimWorkspaceData) {
        const next = this.parseWorkspaceData(JSON.stringify(workspace), workspace.claimRequest?.submittedByName);
        const capturedAmount = this.numberValue(next.securityDeposit.amountCaptured, 0);
        if (capturedAmount > 0) {
            const existingIndex = next.resolutions.findIndex((row) => row.source === "security_deposit");
            const securityRow: ClaimResolutionRow = {
                id: existingIndex >= 0 ? next.resolutions[existingIndex].id : `security-${Date.now()}`,
                filedAmount: 0,
                amountReceived: capturedAmount,
                notes: "Security Deposit Captured",
                source: "security_deposit",
            };
            if (existingIndex >= 0) next.resolutions[existingIndex] = securityRow;
            else next.resolutions.push(securityRow);
        } else {
            next.resolutions = next.resolutions.filter((row) => row.source !== "security_deposit");
        }

        next.claimRequest.totalRequestAmount = next.claimRequest.inputMode === "rows"
            ? next.claimRequest.entries.reduce((sum, entry) => sum + this.numberValue(entry.amount, 0), 0)
            : next.claimRequest.totalRequestAmount;

        const totalAmountReceived = next.resolutions.reduce((sum, row) => sum + this.numberValue(row.amountReceived, 0), 0);
        const totalRequestAmount = this.numberValue(next.claimRequest.totalRequestAmount, 0);
        next.payout.payoutAmount = Math.min(totalAmountReceived, totalRequestAmount) || null;
        if (!next.payout.payee) {
            next.payout.payee = next.claimRequest.payoutToCustom || next.claimRequest.payoutToType || "Owner";
        }

        return next;
    }

    private async getUserDisplay(userId: string, requestUser?: any) {
        const fallbackName = `${requestUser?.firstName || ""} ${requestUser?.lastName || ""}`.trim() || requestUser?.full_name || "SecureStay User";
        const user = await this.userRepo.findOne({ where: { uid: userId } });
        if (!user) {
            return {
                id: userId,
                name: fallbackName,
            };
        }

        return {
            id: userId,
            name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || fallbackName,
        };
    }

    private extractPropertyType(listing?: Listing | null) {
        const tags = Array.isArray((listing as any)?.tags) ? ((listing as any).tags as string[]) : [];
        const normalized = tags.map((tag) => String(tag).toLowerCase());
        if (normalized.includes("own-arb") || (normalized.includes("own") && normalized.includes("arb"))) return "Own-Arb";
        if (normalized.includes("own")) return "Own";
        if (normalized.includes("arb")) return "Arb";
        if (normalized.includes("pm")) return "PM";
        return null;
    }

    private formatReservationCandidate(reservation: ReservationInfoEntity, listing?: Listing | null) {
        return {
            id: reservation.id,
            guestName: reservation.guestName || `${reservation.guestFirstName || ""} ${reservation.guestLastName || ""}`.trim(),
            property: reservation.listingName || listing?.internalListingName || "",
            propertyType: this.extractPropertyType(listing),
            checkInDate: reservation.arrivalDate ? format(new Date(reservation.arrivalDate), "yyyy-MM-dd") : null,
            checkOutDate: reservation.departureDate ? format(new Date(reservation.departureDate), "yyyy-MM-dd") : null,
            checkoutDisplay: reservation.departureDate ? format(new Date(reservation.departureDate), "MMM d, yyyy") : "",
            channel: reservation.channelName || reservation.source || "",
            confirmationNumber: reservation.confirmation_code || reservation.channelReservationId || reservation.hostawayReservationId || "",
            reservationId: String(reservation.id),
            reservationLink: `https://dashboard.hostaway.com/v3/reservations/${reservation.id}`,
            guestEmail: reservation.guestEmail || "",
            guestPhone: reservation.phone || "",
            integration: reservation.integration_nickname || reservation.source || reservation.channelName || "",
            hoverSummary: `${reservation.listingName || listing?.internalListingName || "Property"} • ${reservation.arrivalDate ? format(new Date(reservation.arrivalDate), "MMM d") : "-"} - ${reservation.departureDate ? format(new Date(reservation.departureDate), "MMM d, yyyy") : "-"}`,
        };
    }

    async getReportMetadata(requestUser: any) {
        await this.ensureSchema();
        const currentUser = await this.getUserDisplay(requestUser.id, requestUser);
        return {
            currentUserName: currentUser.name,
            claimStatusOptions: {
                New: ["New"],
                "Pre-Filing": ["Reviewing", "Gathering Documents", "Ready to Submit"],
                Submitted: ["Awaiting Guest Response", "Airbnb Involved", "In Discussion", "Additional Docs Required"],
                Closed: ["Denied", "Appealed", "Appeal Denied"],
            },
            claimCategories: ["Damage", "Missing Items", "House Rule Violation", "Extra Cleaning", "Others"],
            reportedByOptions: ["Cleaner", "Owner", "Add Custom"],
            payoutToOptions: ["Cleaner", "Owner", "LL", "Add Custom"],
            securityDepositStatuses: ["Captured", "Not Authorized", "Authorized", "N/A"],
        };
    }

    async getReservationCandidates(listingId?: number | null, windowOffset = 0) {
        await this.ensureSchema();
        const today = format(new Date(), "yyyy-MM-dd");
        const windowEnd = subDays(new Date(), windowOffset * 14);
        const windowStart = subDays(new Date(), (windowOffset + 1) * 14);

        const currentStayQuery = this.reservationRepo
            .createQueryBuilder("reservation")
            .where("reservation.status NOT IN (:...excluded)", { excluded: ["cancelled", "inquiry", "declined"] })
            .andWhere("DATE(reservation.arrivalDate) <= :today", { today })
            .andWhere("DATE(reservation.departureDate) >= :today", { today });

        const pastWindowQuery = this.reservationRepo
            .createQueryBuilder("reservation")
            .where("reservation.status NOT IN (:...excluded)", { excluded: ["cancelled", "inquiry", "declined"] })
            .andWhere("DATE(reservation.departureDate) >= :windowStart", { windowStart: format(windowStart, "yyyy-MM-dd") })
            .andWhere("DATE(reservation.departureDate) < :windowEnd", { windowEnd: format(windowEnd, "yyyy-MM-dd") });

        if (listingId) {
            currentStayQuery.andWhere("reservation.listingMapId = :listingId", { listingId });
            pastWindowQuery.andWhere("reservation.listingMapId = :listingId", { listingId });
        }

        const [currentStays, pastWindowRows] = await Promise.all([
            windowOffset === 0 ? currentStayQuery.orderBy("reservation.departureDate", "ASC").getMany() : Promise.resolve([]),
            pastWindowQuery.orderBy("reservation.departureDate", "DESC").getMany(),
        ]);

        const reservations = [...currentStays, ...pastWindowRows];
        const listingIds = Array.from(new Set(reservations.map((row) => Number(row.listingMapId)).filter(Boolean)));
        const listings = listingIds.length ? await this.listingRepo.find({ where: { id: In(listingIds) as any } }) : [];
        const listingMap = new Map(listings.map((listing) => [Number(listing.id), listing]));

        return {
            windowOffset,
            hasMore: pastWindowRows.length >= 1,
            candidates: reservations.map((reservation) => this.formatReservationCandidate(reservation, listingMap.get(Number(reservation.listingMapId)) || null)),
        };
    }

    private buildEntryAsset(file: Express.Multer.File, manifest?: AttachmentManifestItem | null): ClaimEntryAsset {
        return {
            id: manifest?.clientKey || file.filename,
            fileName: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            capturedAt: manifest?.capturedAt || new Date().toISOString(),
            url: this.buildAttachmentUrl(file.filename),
        };
    }

    private applyUploadedAssets(
        workspace: ClaimWorkspaceData,
        files: Express.Multer.File[],
        manifest: AttachmentManifestItem[]
    ) {
        if (!files.length) return workspace;
        const next = this.parseWorkspaceData(JSON.stringify(workspace), workspace.claimRequest?.submittedByName);
        files.forEach((file, index) => {
            const manifestItem = manifest[index] || null;
            const asset = this.buildEntryAsset(file, manifestItem);
            if (manifestItem?.section === "entry-photo" && manifestItem.entryId) {
                const entry = next.claimRequest.entries.find((row) => row.id === manifestItem.entryId);
                if (entry) entry.photos = [...(entry.photos || []), asset];
            } else if (manifestItem?.section === "entry-invoice" && manifestItem.entryId) {
                const entry = next.claimRequest.entries.find((row) => row.id === manifestItem.entryId);
                if (entry) entry.invoice = asset;
            } else if (manifestItem?.section === "shared-invoice") {
                next.claimRequest.sharedInvoice = asset;
            } else {
                next.claimRequest.sharedPhotos = [...(next.claimRequest.sharedPhotos || []), asset];
            }
        });
        return next;
    }

    private async persistFilesForClaim(claimId: number, userId: string, files: Express.Multer.File[]) {
        for (const file of files) {
            const record = this.fileInfoRepo.create({
                entityType: "claims",
                entityId: claimId,
                fileName: file.filename,
                createdBy: userId,
                localPath: file.path,
                mimetype: file.mimetype,
                originalName: file.originalname,
            });
            await this.fileInfoRepo.save(record);
        }
    }

    private buildClaimSummaryText(workspace: ClaimWorkspaceData) {
        if (workspace.claimRequest.inputMode === "shared") {
            return workspace.claimRequest.sharedDescription || "";
        }
        return workspace.claimRequest.entries
            .map((entry) => `${entry.category}: ${entry.details}`)
            .filter(Boolean)
            .slice(0, 3)
            .join(" | ");
    }

    private getPrimaryClaimType(workspace: ClaimWorkspaceData) {
        if (workspace.claimRequest.inputMode === "shared") {
            return workspace.claimRequest.sharedCategories[0] || "Others";
        }
        return workspace.claimRequest.entries.find((entry) => entry.category)?.category || "Others";
    }

    private async logActivity(claimId: number, type: "system" | "field_change" | "discussion" | "slack", actorId: string | null, actorName: string | null, title: string | null, content: string, metadata: Record<string, any> | null = null) {
        const entry = this.activityRepo.create({
            claimId,
            type,
            actorId,
            actorName,
            title,
            content,
            metadata,
        });
        await this.activityRepo.save(entry);
    }

    private summarizeChanges(previous: ClaimWorkspaceData, next: ClaimWorkspaceData) {
        const changes: Array<{ label: string; oldValue: string | null; newValue: string | null }> = [];
        const push = (label: string, oldValue: any, newValue: any) => {
            const oldText = oldValue == null ? null : String(oldValue);
            const newText = newValue == null ? null : String(newValue);
            if (oldText !== newText) {
                changes.push({ label, oldValue: oldText, newValue: newText });
            }
        };

        push("Claim status", this.getVisibleStatus(previous), this.getVisibleStatus(next));
        push("Reported by", previous.claimRequest.reportedByCustom || previous.claimRequest.reportedByType, next.claimRequest.reportedByCustom || next.claimRequest.reportedByType);
        push("Payout to", previous.claimRequest.payoutToCustom || previous.claimRequest.payoutToType, next.claimRequest.payoutToCustom || next.claimRequest.payoutToType);
        push("Security deposit status", previous.securityDeposit.status, next.securityDeposit.status);
        push("Amount captured", previous.securityDeposit.amountCaptured, next.securityDeposit.amountCaptured);
        push("Total request amount", previous.claimRequest.totalRequestAmount, next.claimRequest.totalRequestAmount);
        push("Payout status", previous.payout.status, next.payout.status);
        push("Payout amount", previous.payout.payoutAmount, next.payout.payoutAmount);
        return changes;
    }

    private async buildWorkspaceFromPayload(payload: any, requestUser: any, existing?: ClaimWorkspaceData, uploadedFiles: Express.Multer.File[] = []) {
        const currentUser = await this.getUserDisplay(requestUser.id, requestUser);
        const workspace = this.parseWorkspaceData(existing ? JSON.stringify(existing) : null, currentUser.name);

        workspace.reservation = {
            ...workspace.reservation,
            ...(payload.reservation || {}),
        };
        workspace.claimRequest = {
            ...workspace.claimRequest,
            ...(payload.claimRequest || {}),
            submittedByName: workspace.claimRequest.submittedByName || currentUser.name,
        };
        workspace.securityDeposit = {
            ...workspace.securityDeposit,
            ...(payload.securityDeposit || {}),
        };
        workspace.resolutions = Array.isArray(payload.resolutions) ? payload.resolutions : workspace.resolutions;
        workspace.payout = {
            ...workspace.payout,
            ...(payload.payout || {}),
        };

        const manifest = (() => {
            try {
                return JSON.parse(String(payload.attachmentManifest || "[]")) as AttachmentManifestItem[];
            } catch {
                return [] as AttachmentManifestItem[];
            }
        })();

        const withAssets = this.applyUploadedAssets(workspace, uploadedFiles, manifest);
        return this.applyResolutionAndPayoutSync(withAssets);
    }

    private async ensureClaimSlackThread(claim: Claim, userId: string) {
        const existing = await this.slackMessageRepo.findOne({ where: { entityType: "claim", entityId: claim.id } });
        if (existing?.channel && existing?.messageTs) return existing;

        const user = await this.getUserDisplay(userId);
        const message = buildClaimSlackMessage(claim, user.name);
        const slackResponse = await sendSlackMessage(message);
        if (!slackResponse?.channel || !slackResponse?.ts) {
            return null;
        }

        const slackMessageService = new SlackMessageService();
        await slackMessageService.saveSlackMessageInfo({
            channel: slackResponse.channel,
            messageTs: slackResponse.ts,
            threadTs: slackResponse.ts,
            entityType: "claim",
            entityId: claim.id,
            originalMessage: JSON.stringify(message),
        });
        return await this.slackMessageRepo.findOne({ where: { entityType: "claim", entityId: claim.id } });
    }

    private buildSlackPermalink(slackMessage?: SlackMessageEntity | null) {
        if (!slackMessage?.channel || !slackMessage?.threadTs) return null;
        const workspaceUrl = String(process.env.SLACK_WORKSPACE_URL || "").trim();
        if (!workspaceUrl) return null;
        return generateSlackMessageLink(workspaceUrl.replace(/\/$/, ""), slackMessage.channel, slackMessage.threadTs);
    }

    private async fetchSlackReplies(slackMessage?: SlackMessageEntity | null) {
        if (!slackMessage?.channel || !slackMessage?.threadTs || !process.env.SLACK_BOT_TOKEN) return [];
        try {
            const response = await axios.get("https://slack.com/api/conversations.replies", {
                headers: {
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                },
                params: {
                    channel: slackMessage.channel,
                    ts: slackMessage.threadTs,
                    inclusive: true,
                    limit: 100,
                },
            });
            const messages = Array.isArray(response.data?.messages) ? response.data.messages : [];
            return messages
                .filter((message: any) => message.ts !== slackMessage.threadTs)
                .map((message: any) => ({
                    id: `slack-${message.ts}`,
                    sourceType: "slack" as const,
                    authorName: message.user || message.username || "Slack",
                    content: message.text || "",
                    createdAt: new Date(Number(String(message.ts).split(".")[0]) * 1000).toISOString(),
                    metadata: { slackMessageTs: message.ts, slackPermalink: this.buildSlackPermalink(slackMessage) },
                }));
        } catch {
            return [];
        }
    }

    async createReportClaim(payload: any, requestUser: any, uploadedFiles: Express.Multer.File[] = []) {
        await this.ensureSchema();
        const workspace = await this.buildWorkspaceFromPayload(payload, requestUser, undefined, uploadedFiles);
        const listingName = workspace.reservation.listingId
            ? (await this.listingRepo.findOne({ where: { id: Number(workspace.reservation.listingId) } }))?.internalListingName || workspace.reservation.listingName || ""
            : workspace.reservation.listingName || "";
        const visibleStatus = this.getVisibleStatus(workspace);
        const currentUser = await this.getUserDisplay(requestUser.id, requestUser);

        const claim = this.claimRepo.create({
            listing_id: String(workspace.reservation.listingId || ""),
            listing_name: listingName,
            reservation_id: workspace.reservation.reservationId,
            reservation_link: workspace.reservation.reservationLink,
            reservation_code: workspace.reservation.confirmationNumber,
            reservation_amount: null,
            channel: workspace.reservation.channel,
            guest_name: workspace.reservation.guestName,
            guest_contact_number: workspace.reservation.guestPhone,
            status: this.getLegacyStatus(workspace.claimRequest.statusGroup, workspace.claimRequest.statusDetail),
            description: this.buildClaimSummaryText(workspace),
            client_requested_amount: this.numberValue(workspace.claimRequest.totalRequestAmount, 0),
            airbnb_filing_amount: 0,
            claim_type: this.getPrimaryClaimType(workspace),
            reporter: workspace.claimRequest.reportedByCustom || workspace.claimRequest.reportedByType,
            payee: workspace.claimRequest.payoutToCustom || workspace.claimRequest.payoutToType,
            payment_status: workspace.payout.status === "Received" ? "Paid" : workspace.payout.status === "No Payout" ? "Not Paid" : "Partially Paid",
            claim_resolution_amount: workspace.resolutions.reduce((sum, row) => sum + this.numberValue(row.filedAmount, 0), 0),
            client_paid_amount: workspace.resolutions.reduce((sum, row) => sum + this.numberValue(row.amountReceived, 0), 0),
            fileNames: JSON.stringify(uploadedFiles.map((file) => file.filename)),
            workspace_data: JSON.stringify(workspace),
            created_by: requestUser.id,
            updated_by: requestUser.id,
        });

        const savedClaim = await this.claimRepo.save(claim);
        await this.persistFilesForClaim(savedClaim.id, requestUser.id, uploadedFiles);
        await this.logActivity(savedClaim.id, "system", currentUser.id, currentUser.name, "Claim Created", `Claim log created with status ${visibleStatus}.`);
        return this.getClaimDetail(savedClaim.id);
    }

    async getClaimDetail(id: number) {
        await this.ensureSchema();
        const claim = await this.claimRepo.findOne({ where: { id } });
        if (!claim) throw CustomErrorHandler.notFound("Claim not found");

        const workspace = this.applyResolutionAndPayoutSync(this.parseWorkspaceData(claim.workspace_data));
        const slackThread = await this.slackMessageRepo.findOne({ where: { entityType: "claim", entityId: claim.id } });
        return {
            id: claim.id,
            claim: {
                ...claim,
                visibleStatus: this.getVisibleStatus(workspace),
                workspace,
                totalAmountReceived: workspace.resolutions.reduce((sum, row) => sum + this.numberValue(row.amountReceived, 0), 0),
                totalRequestAmount: this.numberValue(workspace.claimRequest.totalRequestAmount, 0),
                slackThreadPermalink: this.buildSlackPermalink(slackThread),
            },
        };
    }

    async updateClaimDetail(id: number, payload: any, requestUser: any, uploadedFiles: Express.Multer.File[] = []) {
        await this.ensureSchema();
        const claim = await this.claimRepo.findOne({ where: { id } });
        if (!claim) throw CustomErrorHandler.notFound("Claim not found");

        const previous = this.parseWorkspaceData(claim.workspace_data);
        const nextWorkspace = await this.buildWorkspaceFromPayload(payload, requestUser, previous, uploadedFiles);
        const changes = this.summarizeChanges(previous, nextWorkspace);

        claim.workspace_data = JSON.stringify(nextWorkspace);
        const existingFileNames = (() => {
            try {
                return JSON.parse(claim.fileNames || "[]") as string[];
            } catch {
                return [] as string[];
            }
        })();
        claim.fileNames = JSON.stringify([...existingFileNames, ...uploadedFiles.map((file) => file.filename)]);
        claim.status = this.getLegacyStatus(nextWorkspace.claimRequest.statusGroup, nextWorkspace.claimRequest.statusDetail);
        claim.description = this.buildClaimSummaryText(nextWorkspace);
        claim.claim_type = this.getPrimaryClaimType(nextWorkspace);
        claim.client_requested_amount = this.numberValue(nextWorkspace.claimRequest.totalRequestAmount, 0);
        claim.claim_resolution_amount = nextWorkspace.resolutions.reduce((sum, row) => sum + this.numberValue(row.filedAmount, 0), 0);
        claim.client_paid_amount = nextWorkspace.resolutions.reduce((sum, row) => sum + this.numberValue(row.amountReceived, 0), 0);
        claim.reporter = nextWorkspace.claimRequest.reportedByCustom || nextWorkspace.claimRequest.reportedByType;
        claim.payee = nextWorkspace.payout.payee || nextWorkspace.claimRequest.payoutToCustom || nextWorkspace.claimRequest.payoutToType;
        claim.payment_status = nextWorkspace.payout.status === "Received" ? "Paid" : nextWorkspace.payout.status === "No Payout" ? "Not Paid" : "Partially Paid";
        claim.updated_by = requestUser.id;

        const savedClaim = await this.claimRepo.save(claim);
        await this.persistFilesForClaim(savedClaim.id, requestUser.id, uploadedFiles);

        if (changes.length > 0) {
            const actor = await this.getUserDisplay(requestUser.id, requestUser);
            await this.logActivity(
                savedClaim.id,
                "field_change",
                actor.id,
                actor.name,
                "Claim Updated",
                changes.map((change) => `${change.label}: ${change.oldValue || "empty"} → ${change.newValue || "empty"}`).join("\n"),
                { changes }
            );
        }

        return this.getClaimDetail(savedClaim.id);
    }

    async getClaimDiscussionFeed(claimId: number) {
        await this.ensureSchema();
        const claim = await this.claimRepo.findOne({ where: { id: claimId } });
        if (!claim) throw CustomErrorHandler.notFound("Claim not found");

        const [messages, activities, slackThread] = await Promise.all([
            this.discussionRepo.find({ where: { claimId }, order: { createdAt: "ASC" } }),
            this.activityRepo.find({ where: { claimId }, order: { createdAt: "ASC" } }),
            this.slackMessageRepo.findOne({ where: { entityType: "claim", entityId: claimId } }),
        ]);
        const slackReplies = await this.fetchSlackReplies(slackThread);

        const discussionItems = messages.map((message) => ({
            id: String(message.id),
            persistentId: message.id,
            sourceType: message.sourceType,
            authorName: message.authorName,
            authorAvatar: message.authorAvatar || undefined,
            content: message.content,
            mentions: message.mentions || [],
            createdAt: new Date(message.createdAt).toISOString(),
            metadata: message.metadata || null,
            attachments: Array.isArray(message.metadata?.attachments) ? message.metadata.attachments : [],
        }));

        const activityItems = activities.map((activity) => ({
            id: `activity-${activity.id}`,
            persistentId: activity.id,
            sourceType: "system" as const,
            authorName: activity.actorName || "SecureStay",
            content: activity.content,
            mentions: [],
            createdAt: new Date(activity.createdAt).toISOString(),
            metadata: {
                title: activity.title,
                type: activity.type,
                changes: activity.metadata?.changes || null,
            },
        }));

        const items = [...activityItems, ...discussionItems, ...slackReplies].sort(
            (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
        );

        return {
            items,
            threadInfo: {
                exists: Boolean(slackThread?.threadTs && slackThread?.channel),
                slackThreadTs: slackThread?.threadTs || null,
                slackChannelId: slackThread?.channel || null,
                slackPermalink: this.buildSlackPermalink(slackThread),
            },
        };
    }

    async postClaimDiscussionMessage(claimId: number, content: string, requestUser: any, uploadedFiles: Express.Multer.File[] = []) {
        await this.ensureSchema();
        const claim = await this.claimRepo.findOne({ where: { id: claimId } });
        if (!claim) throw CustomErrorHandler.notFound("Claim not found");
        const actor = await this.getUserDisplay(requestUser.id, requestUser);
        const attachments: ClaimDiscussionAttachment[] = uploadedFiles.map((file) => ({
            fileName: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            url: this.buildAttachmentUrl(file.filename),
        }));
        const message = this.discussionRepo.create({
            claimId,
            parentMessageId: null,
            sourceType: "note",
            authorId: actor.id,
            authorName: actor.name,
            authorAvatar: null,
            content,
            mentions: Array.from(new Set((content.match(/@([a-zA-Z0-9._-]+)/g) || []).map((match) => match.toLowerCase()))),
            metadata: {
                attachments,
            },
        });
        const saved = await this.discussionRepo.save(message);
        await this.persistFilesForClaim(claimId, requestUser.id, uploadedFiles);
        await this.logActivity(claimId, "discussion", actor.id, actor.name, "Discussion Update", content, { attachmentCount: attachments.length });

        const slackThread = await this.ensureClaimSlackThread(claim, requestUser.id);
        if (slackThread?.channel && slackThread?.threadTs) {
            const text = attachments.length
                ? `${content || "Added claim discussion update"}\n${attachments.map((attachment) => `• ${attachment.originalName}`).join("\n")}`
                : content;
            await sendSlackMessage({ channel: slackThread.channel, text }, slackThread.threadTs);
        }

        return {
            id: String(saved.id),
            sourceType: saved.sourceType,
            authorName: saved.authorName,
            content: saved.content,
            createdAt: new Date(saved.createdAt).toISOString(),
            attachments,
            metadata: saved.metadata,
        };
    }

    async getClaimThreadInfo(claimId: number) {
        await this.ensureSchema();
        const slackThread = await this.slackMessageRepo.findOne({ where: { entityType: "claim", entityId: claimId } });
        return {
            exists: Boolean(slackThread?.threadTs && slackThread?.channel),
            slackThreadTs: slackThread?.threadTs || null,
            slackChannelId: slackThread?.channel || null,
            slackPermalink: this.buildSlackPermalink(slackThread),
        };
    }

    async ensureThreadForClaim(claimId: number, requestUser: any) {
        await this.ensureSchema();
        const claim = await this.claimRepo.findOne({ where: { id: claimId } });
        if (!claim) throw CustomErrorHandler.notFound("Claim not found");
        const slackThread = await this.ensureClaimSlackThread(claim, requestUser.id);
        return {
            exists: Boolean(slackThread?.threadTs && slackThread?.channel),
            slackThreadTs: slackThread?.threadTs || null,
            slackChannelId: slackThread?.channel || null,
            slackPermalink: this.buildSlackPermalink(slackThread),
        };
    }

    async suggestClaimEntries(descriptions: string | null, categories: string[] | null, files: Express.Multer.File[]) {
        if (!process.env.OPENAI_API_KEY || !files.length) {
            return { entries: [] };
        }
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const content: any[] = [
            {
                type: "input_text",
                text: [
                    "You are helping draft a vacation rental damage claim intake.",
                    "Look only at the uploaded images and any provided notes.",
                    "Return JSON with keys: entries.",
                    "Each entry should contain: category, details.",
                    "Suggested categories must be one of: Damage, Missing Items, House Rule Violation, Extra Cleaning, Others.",
                    "Do not guess dollar amounts.",
                    descriptions ? `User notes: ${descriptions}` : "",
                    categories?.length ? `Preferred categories: ${categories.join(", ")}` : "",
                ].filter(Boolean).join("\n"),
            },
        ];

        for (const file of files) {
            const base64 = file.buffer?.toString("base64");
            if (!base64) continue;
            const fileData = `data:${file.mimetype};base64,${base64}`;
            if (file.mimetype?.startsWith("image/")) {
                content.push({
                    type: "input_image",
                    image_url: fileData,
                });
            } else {
                content.push({
                    type: "input_file",
                    filename: file.originalname || "claim-attachment",
                    file_data: fileData,
                });
            }
        }

        const response = await openai.responses.create({
            model: "gpt-4.1-mini",
            input: [{
                role: "user",
                content,
            }],
            text: {
                format: {
                    type: "json_schema",
                    name: "claim_entry_suggestions",
                    schema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            entries: {
                                type: "array",
                                items: {
                                    type: "object",
                                    additionalProperties: false,
                                    properties: {
                                        category: {
                                            type: "string",
                                            enum: ["Damage", "Missing Items", "House Rule Violation", "Extra Cleaning", "Others"],
                                        },
                                        details: { type: "string" },
                                    },
                                    required: ["category", "details"],
                                },
                            },
                        },
                        required: ["entries"],
                    },
                },
            },
        });

        const text = response.output_text || "{\"entries\":[]}";
        try {
            return JSON.parse(text);
        } catch {
            return { entries: [] };
        }
    }
}
