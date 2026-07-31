import axios from "axios";
import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ExpenseEntity } from "../entity/Expense";
import { ExpenseHistoryEntity } from "../entity/ExpenseHistory";
import { Resolution } from "../entity/Resolution";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { UsersEntity } from "../entity/Users";
import { Employee } from "../entity/Employee";
import { FileInfo } from "../entity/FileInfo";
import { generateSlackMessageLink } from "../helpers/helpers";
import CustomErrorHandler from "../middleware/customError.middleware";
import sendSlackMessage from "../utils/sendSlackMsg";
import updateSlackMessage from "../utils/updateSlackMsg";

type AccountingActivityEntityType = "expense" | "resolution";

export class AccountingActivityService {
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);
    private expenseHistoryRepo = appDatabase.getRepository(ExpenseHistoryEntity);
    private resolutionRepo = appDatabase.getRepository(Resolution);
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private employeeRepo = appDatabase.getRepository(Employee);
    private fileInfoRepo = appDatabase.getRepository(FileInfo);

    private async ensureDiscussionTable() {
        await appDatabase.query(`
            CREATE TABLE IF NOT EXISTS accounting_discussions (
                id INT NOT NULL AUTO_INCREMENT,
                entityType VARCHAR(20) NOT NULL,
                entityId INT NOT NULL,
                message TEXT NOT NULL,
                createdBy VARCHAR(255) NOT NULL,
                createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_accounting_discussions_entity (entityType, entityId, createdAt)
            )
        `);
        const columns: any[] = await appDatabase.query("SHOW COLUMNS FROM accounting_discussions");
        const columnNames = new Set(columns.map((column) => String(column.Field)));
        const additions = [
            ["updatedBy", "VARCHAR(255) NULL"],
            ["updatedAt", "TIMESTAMP NULL"],
            ["deletedBy", "VARCHAR(255) NULL"],
            ["deletedAt", "TIMESTAMP NULL"],
            ["slackMessageTs", "VARCHAR(50) NULL"],
        ];
        for (const [name, definition] of additions) {
            if (!columnNames.has(name)) {
                try {
                    await appDatabase.query(`ALTER TABLE accounting_discussions ADD COLUMN ${name} ${definition}`);
                } catch (error: any) {
                    if (error?.code !== "ER_DUP_FIELDNAME") throw error;
                }
            }
        }
    }

    private isAdmin(user?: UsersEntity | null) {
        return Boolean(user?.isSuperAdmin)
            || user?.userType === "admin"
            || user?.userType === "super admin";
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

    private async getActorProfile(uid: string) {
        const user = await this.usersRepo.findOne({ where: { uid }, withDeleted: true });
        const employee = user
            ? await this.employeeRepo.findOne({ where: { userId: user.id }, withDeleted: true })
            : null;
        const photoId = Number(employee?.profilePhoto);
        const photoInfo = Number.isFinite(photoId) && photoId > 0
            ? await this.fileInfoRepo.findOne({ where: { id: photoId } })
            : null;
        return {
            name: user
                ? employee?.preferredName
                    || [user.firstName, user.lastName].filter(Boolean).join(" ")
                    || user.email
                    || uid
                : uid || "SecureStay",
            avatar: this.buildEmployeePhotoUrl(photoInfo),
        };
    }

    private async getSlackThread(entityType: AccountingActivityEntityType, entityId: number) {
        const expense = await this.resolveExpense(entityType, entityId);
        if (!expense) return null;
        return this.slackMessageRepo.findOne({
            where: { entityType: "expense", entityId: expense.id },
            order: { id: "DESC" },
        });
    }

    private async resolveExpense(entityType: AccountingActivityEntityType, entityId: number) {
        if (entityType === "expense") {
            return this.expenseRepo.findOne({ where: { id: entityId } });
        }
        const resolution = await this.resolutionRepo.findOne({ where: { id: entityId } });
        if (!resolution) return null;
        return this.expenseRepo.findOne({
            where: { resolutionId: resolution.id },
            order: { updatedAt: "DESC" },
        });
    }

    private formatFieldName(fieldName: string) {
        const labels: Record<string, string> = {
            listingMapId: "Property",
            expenseDate: "Expense date",
            concept: "Description",
            amount: "Amount",
            categories: "Category",
            dateOfWork: "Date of work",
            contractorName: "Contractor",
            contractorNumber: "Contractor number",
            findings: "Findings",
            status: "Status",
            paymentMethod: "Payment method",
            paymentDetails: "Payment details",
            slackNotes: "Slack notes",
            datePaid: "Date paid",
            issues: "Issues",
            isRecurring: "Recurring",
            llCover: "LL Cover",
            fromClaimsFee: "From Claims Fee",
            fromPlus50: "From +50",
            deductFromRent: "Deduct from Rent",
            reservationId: "Reservation",
            guestName: "Guest name",
            fileNames: "Attachments",
            isDeleted: "Record",
        };
        return labels[fieldName] || fieldName.replace(/([a-z])([A-Z])/g, "$1 $2");
    }

    private buildSystemMessage(row: ExpenseHistoryEntity, actorName: string) {
        const field = this.formatFieldName(row.fieldName);
        if (row.action === "DELETE" || row.fieldName === "isDeleted") {
            return `${field} was deleted by ${actorName}.`;
        }
        const oldValue = row.oldValue || "—";
        const newValue = row.newValue || "—";
        return `${field} changed from ${oldValue} to ${newValue} by ${actorName}.`;
    }

    private buildSlackPermalink(slackMessage?: SlackMessageEntity | null) {
        if (!slackMessage?.channel || !slackMessage?.threadTs) return null;
        const workspaceUrl = String(process.env.SLACK_WORKSPACE_URL || "").trim();
        if (!workspaceUrl) return null;
        return generateSlackMessageLink(workspaceUrl.replace(/\/$/, ""), slackMessage.channel, slackMessage.threadTs);
    }

    private async fetchSlackEntries(slackMessage?: SlackMessageEntity | null) {
        if (!slackMessage?.channel || !slackMessage?.threadTs || !process.env.SLACK_BOT_TOKEN) return [];
        try {
            const response = await axios.get("https://slack.com/api/conversations.replies", {
                headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
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
                .map((message: any) => {
                    const isSecureStayApp = Boolean(message.bot_id || message.app_id || message.bot_profile);
                    return {
                        id: `slack-${message.ts}`,
                        source: isSecureStayApp ? "securestay" : "slack",
                        message: String(message.text || ""),
                        createdAt: new Date(Number(String(message.ts).split(".")[0]) * 1000).toISOString(),
                        authorName: isSecureStayApp
                            ? "SecureStay"
                            : message.username || message.user || "Slack",
                        authorId: message.user || null,
                        authorAvatar: isSecureStayApp
                            ? null
                            : message.icons?.image_48 || message.bot_profile?.icons?.image_48 || null,
                        isSecureStayApp,
                        metadata: { slackMessageTs: message.ts },
                    };
                });
        } catch {
            return [];
        }
    }

    async getActivity(entityType: AccountingActivityEntityType, entityId: number, viewerId?: string) {
        await this.ensureDiscussionTable();
        const sourceRecord = entityType === "expense"
            ? await this.expenseRepo.findOne({ where: { id: entityId } })
            : await this.resolutionRepo.findOne({ where: { id: entityId } });
        if (!sourceRecord) throw new Error(`${entityType === "expense" ? "Expense" : "Resolution"} not found.`);
        const expense = await this.resolveExpense(entityType, entityId);
        const discussionRows: any[] = await appDatabase.query(
            `SELECT id, message, createdBy, createdAt, updatedBy, updatedAt, slackMessageTs
             FROM accounting_discussions
             WHERE entityType = ? AND entityId = ? AND deletedAt IS NULL
             ORDER BY createdAt ASC, id ASC`,
            [entityType, entityId]
        );

        const history = expense
            ? await this.expenseHistoryRepo.find({
                where: { expenseId: expense.id },
                order: { changedAt: "ASC", id: "ASC" },
            })
            : [];
        const actorIds = Array.from(new Set([
            sourceRecord.createdBy,
            ...history.map((row) => row.changedBy),
            ...discussionRows.map((row) => row.createdBy),
        ].filter(Boolean)));
        const users = actorIds.length
            ? await this.usersRepo.find({ where: { uid: In(actorIds) }, withDeleted: true })
            : [];
        const employees = users.length
            ? await this.employeeRepo.find({
                where: { userId: In(users.map((user) => user.id)) },
                withDeleted: true,
            })
            : [];
        const employeeByUserId = new Map(employees.map((employee) => [employee.userId, employee]));
        const profilePhotoIds = employees
            .map((employee) => Number(employee.profilePhoto))
            .filter((id) => Number.isFinite(id) && id > 0);
        const profilePhotos = profilePhotoIds.length
            ? await this.fileInfoRepo.find({ where: { id: In(profilePhotoIds) } })
            : [];
        const profilePhotoById = new Map(profilePhotos.map((file) => [Number(file.id), file]));
        const userByUid = new Map(users.map((user) => [user.uid, user]));
        const viewer = viewerId
            ? userByUid.get(viewerId)
                || await this.usersRepo.findOne({ where: { uid: viewerId }, withDeleted: true })
            : null;
        const viewerIsAdmin = this.isAdmin(viewer);
        const getActor = (uid: string) => {
            const user = userByUid.get(uid);
            const employee = user ? employeeByUserId.get(user.id) : null;
            const photoInfo = profilePhotoById.get(Number(employee?.profilePhoto));
            return {
                name: user
                    ? employee?.preferredName
                        || [user.firstName, user.lastName].filter(Boolean).join(" ")
                        || user.email
                        || uid
                    : uid || "System",
                avatar: this.buildEmployeePhotoUrl(photoInfo),
            };
        };

        const createdActor = getActor(sourceRecord.createdBy);
        const systemEntries = [{
            id: `system-created-${entityType}-${entityId}`,
            source: "system",
            message: `${entityType === "expense" ? (Number((sourceRecord as ExpenseEntity).amount) >= 0 ? "Extra" : "Expense") : "Resolution"} created by ${createdActor.name}.`,
            createdAt: sourceRecord.createdAt,
            authorName: createdActor.name,
            authorId: sourceRecord.createdBy,
            authorAvatar: createdActor.avatar,
        }, ...history.map((row) => {
            const actor = getActor(row.changedBy);
            return {
                id: `system-${row.id}`,
                source: "system",
                message: this.buildSystemMessage(row, actor.name),
                createdAt: row.changedAt,
                authorName: actor.name,
                authorId: row.changedBy,
                authorAvatar: actor.avatar,
            };
        })];
        const secureStayEntries = discussionRows.map((row) => {
            const actor = getActor(row.createdBy);
            return {
                id: `securestay-${row.id}`,
                discussionId: row.id,
                source: "securestay",
                message: row.message,
                createdAt: row.createdAt,
                authorName: actor.name,
                authorId: row.createdBy,
                authorAvatar: actor.avatar,
                canEdit: Boolean(viewerId && row.createdBy === viewerId),
                canDelete: Boolean(viewerId && (row.createdBy === viewerId || viewerIsAdmin)),
            };
        });

        const slackMessage = await this.getSlackThread(entityType, entityId);
        const persistedSlackMessageTs = new Set(
            discussionRows.map((row) => String(row.slackMessageTs || "")).filter(Boolean)
        );
        const slackEntries = (await this.fetchSlackEntries(slackMessage))
            .filter((entry: any) => !persistedSlackMessageTs.has(String(entry.metadata?.slackMessageTs || "")));
        const entries = [...systemEntries, ...secureStayEntries, ...slackEntries]
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        return {
            entries,
            slackThreadPermalink: this.buildSlackPermalink(slackMessage),
        };
    }

    async createDiscussion(entityType: AccountingActivityEntityType, entityId: number, message: string, userId: string) {
        await this.ensureDiscussionTable();
        const trimmedMessage = String(message || "").trim();
        if (!trimmedMessage) throw new Error("Update message is required.");
        const slackThread = await this.getSlackThread(entityType, entityId);
        if (!slackThread?.channel || !(slackThread.threadTs || slackThread.messageTs)) {
            throw CustomErrorHandler.validationError("The corresponding Slack thread is not available.");
        }
        const actor = await this.getActorProfile(userId);
        const slackResponse = await sendSlackMessage({
            channel: slackThread.channel,
            text: trimmedMessage,
            bot_name: actor.name,
            ...(actor.avatar ? { bot_icon: actor.avatar } : {}),
        }, slackThread.threadTs || slackThread.messageTs);
        if (!slackResponse?.ok || !slackResponse.ts) {
            throw CustomErrorHandler.validationError(`Slack message could not be sent: ${slackResponse?.error || "unknown_error"}`);
        }
        await appDatabase.query(
            `INSERT INTO accounting_discussions (entityType, entityId, message, createdBy, slackMessageTs)
             VALUES (?, ?, ?, ?, ?)`,
            [entityType, entityId, trimmedMessage, userId, slackResponse.ts]
        );
        return this.getActivity(entityType, entityId, userId);
    }

    async updateDiscussion(
        entityType: AccountingActivityEntityType,
        entityId: number,
        discussionId: number,
        message: string,
        userId: string
    ) {
        await this.ensureDiscussionTable();
        const trimmedMessage = String(message || "").trim();
        if (!trimmedMessage) throw CustomErrorHandler.validationError("Update message is required.");
        const rows: any[] = await appDatabase.query(
            `SELECT * FROM accounting_discussions
             WHERE id = ? AND entityType = ? AND entityId = ? AND deletedAt IS NULL LIMIT 1`,
            [discussionId, entityType, entityId]
        );
        const discussion = rows[0];
        if (!discussion) throw CustomErrorHandler.notFound("Discussion not found.");
        if (discussion.createdBy !== userId) {
            throw CustomErrorHandler.forbidden("Only the message author can edit this update.");
        }
        const slackThread = await this.getSlackThread(entityType, entityId);
        if (discussion.slackMessageTs && slackThread?.channel) {
            const slackResponse = await updateSlackMessage(
                { text: trimmedMessage },
                discussion.slackMessageTs,
                slackThread.channel
            );
            if (!slackResponse?.ok) {
                throw CustomErrorHandler.validationError(`Slack message could not be updated: ${slackResponse?.error || "unknown_error"}`);
            }
        }
        await appDatabase.query(
            `UPDATE accounting_discussions
             SET message = ?, updatedBy = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [trimmedMessage, userId, discussionId]
        );
        return this.getActivity(entityType, entityId, userId);
    }

    async deleteDiscussion(
        entityType: AccountingActivityEntityType,
        entityId: number,
        discussionId: number,
        userId: string
    ) {
        await this.ensureDiscussionTable();
        const rows: any[] = await appDatabase.query(
            `SELECT * FROM accounting_discussions
             WHERE id = ? AND entityType = ? AND entityId = ? AND deletedAt IS NULL LIMIT 1`,
            [discussionId, entityType, entityId]
        );
        const discussion = rows[0];
        if (!discussion) throw CustomErrorHandler.notFound("Discussion not found.");
        const viewer = await this.usersRepo.findOne({ where: { uid: userId } });
        if (discussion.createdBy !== userId && !this.isAdmin(viewer)) {
            throw CustomErrorHandler.forbidden("Only the message author or a SecureStay admin can delete this update.");
        }
        const slackThread = await this.getSlackThread(entityType, entityId);
        if (discussion.slackMessageTs && slackThread?.channel && process.env.SLACK_BOT_TOKEN) {
            const response = await axios.post("https://slack.com/api/chat.delete", {
                channel: slackThread.channel,
                ts: discussion.slackMessageTs,
            }, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                },
            });
            if (!response.data?.ok && !["message_not_found", "message_deleted"].includes(response.data?.error)) {
                throw CustomErrorHandler.validationError(`Slack message could not be deleted: ${response.data?.error || "unknown_error"}`);
            }
        }
        await appDatabase.query(
            `UPDATE accounting_discussions
             SET deletedBy = ?, deletedAt = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [userId, discussionId]
        );
        return this.getActivity(entityType, entityId, userId);
    }
}
