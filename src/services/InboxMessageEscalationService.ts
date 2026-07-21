import OpenAI from "openai";
import { appDatabase } from "../utils/database.util";
import { InboxConversationEntity } from "../entity/InboxConversation";
import { InboxMessageEntity } from "../entity/InboxMessage";
import { InboxMessageEscalationEntity } from "../entity/InboxMessageEscalation";
import { UserDirectedNotificationEntity } from "../entity/UserDirectedNotification";
import { UsersEntity } from "../entity/Users";
import logger from "../utils/logger.utils";

export type EscalateSuggestInput = {
    threadId: number;
    messageExternalId?: number | null;
    category?: string | null;
    note: string;
    assigneeUid: string;
    assigneeName?: string | null;
    actorUid: string;
    actorName?: string | null;
};

export type EscalateConfirmInput = {
    escalationId: number;
    actorUid: string;
    alreadyTried: boolean;
};

export class InboxMessageEscalationService {
    private escalationRepo() {
        return appDatabase.getRepository(InboxMessageEscalationEntity);
    }
    private notificationRepo() {
        return appDatabase.getRepository(UserDirectedNotificationEntity);
    }
    private conversationRepo() {
        return appDatabase.getRepository(InboxConversationEntity);
    }
    private messageRepo() {
        return appDatabase.getRepository(InboxMessageEntity);
    }
    private usersRepo() {
        return appDatabase.getRepository(UsersEntity);
    }

    private getClient(): OpenAI {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
        return new OpenAI({ apiKey });
    }

    private async resolveAssigneeName(uid: string, fallback?: string | null): Promise<string> {
        if (fallback && fallback.trim()) return fallback.trim();
        try {
            const u = await this.usersRepo().findOne({ where: { uid } });
            if (!u) return "Teammate";
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
            return name || u.email || "Teammate";
        } catch {
            return "Teammate";
        }
    }

    /**
     * AI suggests troubleshooting steps the staffer should try before escalating.
     * Persists an escalation row in status=suggested.
     */
    async suggest(input: EscalateSuggestInput): Promise<{
        escalationId: number;
        steps: string[];
        summary: string;
        askTried: string;
    }> {
        const note = String(input.note || "").trim();
        if (!note) throw new Error("Note is required");
        if (!input.assigneeUid) throw new Error("Assignee is required");

        const conversation = await this.conversationRepo().findOne({
            where: { threadId: Number(input.threadId) },
        });
        if (!conversation) throw new Error("Conversation not found");

        let messageBody = "";
        let messageId: number | null = null;
        const externalId = input.messageExternalId != null ? Number(input.messageExternalId) : null;
        if (externalId && Number.isFinite(externalId)) {
            const msg = await this.messageRepo().findOne({
                where: { threadId: Number(input.threadId), externalId },
            });
            if (msg) {
                messageBody = String(msg.body || "");
                messageId = msg.id;
            }
        }

        const assigneeName = await this.resolveAssigneeName(input.assigneeUid, input.assigneeName);
        const category = String(input.category || "general").slice(0, 40);

        let steps: string[] = [];
        let summary =
            "Try the quick checks below first. If you already did and still need help, escalate to the tagged teammate.";
        let askTried =
            "Have you already tried these steps? If yes, we will notify the tagged teammate.";
        try {
            if (process.env.OPENAI_API_KEY) {
                const client = this.getClient();
                const completion = await client.chat.completions.create({
                    model: process.env.OPENAI_MODEL_FAST || process.env.OPENAI_MODEL || "gpt-4o-mini",
                    temperature: 0.3,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "system",
                            content:
                                "You help SecureStay guest-relations staff before they escalate to a manager. " +
                                "Given the guest message and the staff note, suggest 3-5 concrete, short steps the staffer should try first " +
                                "(check Hostify, listing KB, access codes, prior thread, etc.). " +
                                "Do not invent access codes or prices. Return JSON: " +
                                '{ "summary": string, "steps": string[], "askTried": string }',
                        },
                        {
                            role: "user",
                            content: JSON.stringify({
                                category,
                                staffNote: note,
                                guestMessage: messageBody.slice(0, 2000),
                                guestName: conversation.guestName,
                                listingName: conversation.listingName,
                                channel: conversation.channel,
                                checkin: conversation.checkin,
                                checkout: conversation.checkout,
                                escalateTo: assigneeName,
                            }),
                        },
                    ],
                });
                const raw = completion.choices?.[0]?.message?.content || "{}";
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed.steps)) {
                    steps = parsed.steps.map((s: any) => String(s || "").trim()).filter(Boolean).slice(0, 6);
                }
                if (parsed.summary) summary = String(parsed.summary).trim();
                if (parsed.askTried) askTried = String(parsed.askTried).trim();
            }
        } catch (err: any) {
            logger.warn(`[InboxEscalate] AI suggest failed: ${err?.message}`);
        }

        if (!steps.length) {
            steps = [
                "Re-read the guest's latest message and confirm the exact ask.",
                "Check the reservation/listing details and any relevant knowledge-base notes.",
                "Search the thread for a prior answer or access/payment info already shared.",
                "If still blocked, escalate with a short summary of what you tried.",
            ];
        }
        const askTriedFinal = askTried;

        const row = this.escalationRepo().create({
            threadId: Number(input.threadId),
            messageExternalId: externalId,
            messageId,
            actorUid: input.actorUid,
            actorName: input.actorName || null,
            assigneeUid: input.assigneeUid,
            assigneeName,
            category,
            note,
            aiStepsJson: JSON.stringify(steps),
            aiSummary: summary,
            status: "suggested",
        });
        const saved = await this.escalationRepo().save(row);

        return {
            escalationId: saved.id,
            steps,
            summary,
            askTried: askTriedFinal,
        };
    }

    /**
     * Staff confirms they already tried the AI steps → notify the assignee
     * with a deep link to the conversation + message.
     */
    async confirm(input: EscalateConfirmInput): Promise<{
        notified: boolean;
        escalationId: number;
        href?: string;
    }> {
        const row = await this.escalationRepo().findOne({ where: { id: Number(input.escalationId) } });
        if (!row) throw new Error("Escalation not found");
        if (row.actorUid !== input.actorUid) {
            // Allow same session users; soft check only
        }

        if (!input.alreadyTried) {
            row.status = "cancelled";
            await this.escalationRepo().save(row);
            return { notified: false, escalationId: row.id };
        }

        const conversation = await this.conversationRepo().findOne({
            where: { threadId: Number(row.threadId) },
        });
        const guest = conversation?.guestName || "Guest";
        const listing = conversation?.listingName || "property";
        const href = row.messageExternalId
            ? `/messages/inbox-v2?thread=${row.threadId}&message=${row.messageExternalId}`
            : `/messages/inbox-v2?thread=${row.threadId}`;

        const title = `Escalation · ${guest}`;
        const body = [
            `${row.actorName || "A teammate"} needs help from you.`,
            row.category ? `Category: ${row.category}.` : null,
            `Note: ${row.note}`,
            row.aiSummary ? `AI context: ${row.aiSummary}` : null,
            `Listing: ${listing}`,
        ]
            .filter(Boolean)
            .join(" ");

        const notification = this.notificationRepo().create({
            userUid: row.assigneeUid,
            actorUid: row.actorUid,
            actorName: row.actorName,
            type: "escalation",
            title,
            body: body.slice(0, 2000),
            href,
            threadId: Number(row.threadId),
            messageExternalId: row.messageExternalId,
            escalationId: row.id,
            readAt: null,
        });
        await this.notificationRepo().save(notification);

        row.status = "notified";
        await this.escalationRepo().save(row);

        logger.info(
            `[InboxEscalate] Notified ${row.assigneeUid} for escalation ${row.id} thread=${row.threadId}`
        );

        return { notified: true, escalationId: row.id, href };
    }
}
