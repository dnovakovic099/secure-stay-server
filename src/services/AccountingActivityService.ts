import axios from "axios";
import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ExpenseEntity } from "../entity/Expense";
import { ExpenseHistoryEntity } from "../entity/ExpenseHistory";
import { Resolution } from "../entity/Resolution";
import { SlackMessageEntity } from "../entity/SlackMessageInfo";
import { UsersEntity } from "../entity/Users";
import { Employee } from "../entity/Employee";
import { generateSlackMessageLink } from "../helpers/helpers";

type AccountingActivityEntityType = "expense" | "resolution";

export class AccountingActivityService {
    private expenseRepo = appDatabase.getRepository(ExpenseEntity);
    private expenseHistoryRepo = appDatabase.getRepository(ExpenseHistoryEntity);
    private resolutionRepo = appDatabase.getRepository(Resolution);
    private slackMessageRepo = appDatabase.getRepository(SlackMessageEntity);
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private employeeRepo = appDatabase.getRepository(Employee);

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
                .filter((message: any) => message.ts !== slackMessage.threadTs && message.subtype !== "bot_message")
                .map((message: any) => ({
                    id: `slack-${message.ts}`,
                    source: "slack",
                    message: String(message.text || ""),
                    createdAt: new Date(Number(String(message.ts).split(".")[0]) * 1000).toISOString(),
                    authorName: message.username || message.user || "Slack",
                    authorId: message.user || null,
                    authorAvatar: message.icons?.image_48 || null,
                    metadata: { slackMessageTs: message.ts },
                }));
        } catch {
            return [];
        }
    }

    async getActivity(entityType: AccountingActivityEntityType, entityId: number) {
        await this.ensureDiscussionTable();
        const sourceRecord = entityType === "expense"
            ? await this.expenseRepo.findOne({ where: { id: entityId } })
            : await this.resolutionRepo.findOne({ where: { id: entityId } });
        if (!sourceRecord) throw new Error(`${entityType === "expense" ? "Expense" : "Resolution"} not found.`);
        const expense = await this.resolveExpense(entityType, entityId);
        const discussionRows: any[] = await appDatabase.query(
            `SELECT id, message, createdBy, createdAt
             FROM accounting_discussions
             WHERE entityType = ? AND entityId = ?
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
            ? await this.usersRepo.find({ where: { uid: In(actorIds) } })
            : [];
        const employees = users.length
            ? await this.employeeRepo.find({ where: { userId: In(users.map((user) => user.id)) } })
            : [];
        const employeeByUserId = new Map(employees.map((employee) => [employee.userId, employee]));
        const userByUid = new Map(users.map((user) => [user.uid, user]));
        const getActor = (uid: string) => {
            const user = userByUid.get(uid);
            const employee = user ? employeeByUserId.get(user.id) : null;
            return {
                name: user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || uid : uid || "System",
                avatar: employee?.profilePhoto || null,
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
                source: "securestay",
                message: row.message,
                createdAt: row.createdAt,
                authorName: actor.name,
                authorId: row.createdBy,
                authorAvatar: actor.avatar,
            };
        });

        const slackMessage = expense
            ? await this.slackMessageRepo.findOne({
                where: { entityType: "expense", entityId: expense.id },
                order: { id: "DESC" },
            })
            : null;
        const slackEntries = await this.fetchSlackEntries(slackMessage);
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
        await appDatabase.query(
            `INSERT INTO accounting_discussions (entityType, entityId, message, createdBy)
             VALUES (?, ?, ?, ?)`,
            [entityType, entityId, trimmedMessage, userId]
        );
        return this.getActivity(entityType, entityId);
    }
}
