import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { In } from "typeorm";
import {
    AIAnalysisStructuredReport,
    GuestAnalysisReportMessageEntity,
    GuestAnalysisReportSnapshot,
    GuestAnalysisReportSnapshotRecord,
    GuestAnalysisReportThreadEntity,
} from "../entity/GuestAnalysisReportThread";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { GuestAnalysisRecord, GuestAnalysisRecordFilters, GuestAnalysisService } from "./GuestAnalysisService";

interface CreateReportThreadInput {
    name?: string;
    initialPrompt?: string;
    filters?: GuestAnalysisRecordFilters;
    userId?: string | null;
}

interface CreateThreadMessageInput {
    content: string;
    filters?: GuestAnalysisRecordFilters;
    userId?: string | null;
}

export class GuestAnalysisReportThreadService {
    private threadRepo = appDatabase.getRepository(GuestAnalysisReportThreadEntity);
    private messageRepo = appDatabase.getRepository(GuestAnalysisReportMessageEntity);
    private analysisService = new GuestAnalysisService();
    private openai: OpenAI;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is not set in environment variables");
        }
        this.openai = new OpenAI({ apiKey });
    }

    async listThreads() {
        const threads = await this.threadRepo.find({
            order: { updatedAt: "DESC" },
        });
        const threadIds = threads.map((thread) => thread.id);
        const messages = threadIds.length
            ? await this.messageRepo.find({
                where: { threadId: In(threadIds) },
                order: { createdAt: "ASC" },
            })
            : [];

        const messagesByThread = new Map<string, GuestAnalysisReportMessageEntity[]>();
        messages.forEach((message) => {
            const existing = messagesByThread.get(message.threadId) || [];
            existing.push(message);
            messagesByThread.set(message.threadId, existing);
        });

        return threads.map((thread) => this.serializeThread(thread, messagesByThread.get(thread.id) || []));
    }

    async createThread(input: CreateReportThreadInput) {
        const thread = this.threadRepo.create({
            id: uuidv4(),
            name: String(input.name || "").trim() || "New Report Thread",
            createdBy: input.userId || null,
            latestFilters: input.filters || null,
        });

        const savedThread = await this.threadRepo.save(thread);

        if (String(input.initialPrompt || "").trim()) {
            await this.addMessage(savedThread.id, {
                content: String(input.initialPrompt).trim(),
                filters: input.filters,
                userId: input.userId,
            });
        }

        return this.getThread(savedThread.id);
    }

    async getThread(threadId: string) {
        const thread = await this.threadRepo.findOne({ where: { id: threadId } });
        if (!thread) {
            throw new Error("Report thread not found");
        }
        const messages = await this.messageRepo.find({
            where: { threadId },
            order: { createdAt: "ASC" },
        });
        return this.serializeThread(thread, messages);
    }

    async addMessage(threadId: string, input: CreateThreadMessageInput) {
        const thread = await this.threadRepo.findOne({ where: { id: threadId } });
        if (!thread) {
            throw new Error("Report thread not found");
        }
        if (!String(input.content || "").trim()) {
            throw new Error("Report instructions are required");
        }

        const userMessage = this.messageRepo.create({
            id: uuidv4(),
            threadId,
            role: "user",
            content: String(input.content || "").trim(),
            filterSnapshot: input.filters || thread.latestFilters || null,
            datasetSnapshot: null,
            structuredReport: null,
            createdBy: input.userId || null,
        });
        await this.messageRepo.save(userMessage);

        const records = await this.analysisService.getAllAnalysisRecords(input.filters || thread.latestFilters || {});
        const snapshot = this.buildSnapshot(records, input.filters || thread.latestFilters || {});
        const history = await this.messageRepo.find({
            where: { threadId },
            order: { createdAt: "ASC" },
        });
        const structuredReport = await this.generateStructuredReport(thread.name, history, snapshot);

        const assistantMessage = this.messageRepo.create({
            id: uuidv4(),
            threadId,
            role: "assistant",
            content: structuredReport.executiveSummary,
            filterSnapshot: snapshot.filters,
            datasetSnapshot: snapshot,
            structuredReport,
            createdBy: input.userId || null,
        });
        await this.messageRepo.save(assistantMessage);

        thread.latestFilters = snapshot.filters;
        thread.updatedAt = new Date();
        await this.threadRepo.save(thread);

        return this.getThread(threadId);
    }

    private serializeThread(thread: GuestAnalysisReportThreadEntity, messages: GuestAnalysisReportMessageEntity[]) {
        return {
            ...thread,
            messageCount: messages.length,
            latestMessage: messages[messages.length - 1] || null,
            messages,
        };
    }

    private buildSnapshot(records: GuestAnalysisRecord[], filters: GuestAnalysisRecordFilters): GuestAnalysisReportSnapshot {
        return {
            generatedAt: new Date().toISOString(),
            filters,
            totalRecords: records.length,
            records: records.map((record) => this.serializeSnapshotRecord(record)),
        };
    }

    private serializeSnapshotRecord(record: GuestAnalysisRecord): GuestAnalysisReportSnapshotRecord {
        return {
            id: record.id,
            reservationId: record.reservationId,
            guestName: record.guestName,
            listingName: record.listingName,
            arrivalDate: record.arrivalDate,
            departureDate: record.departureDate,
            bookingPhase: record.bookingPhase,
            sentiment: record.sentiment,
            summary: record.summary,
            categories: record.categories,
            departments: record.departments,
            priority: record.priority,
            status: record.status,
            flagCount: record.flagCount,
        };
    }

    private async generateStructuredReport(
        threadName: string,
        history: GuestAnalysisReportMessageEntity[],
        snapshot: GuestAnalysisReportSnapshot,
    ): Promise<AIAnalysisStructuredReport> {
        const recentHistory = history.slice(-8).map((message) => ({
            role: message.role,
            content: message.structuredReport
                ? JSON.stringify(message.structuredReport)
                : message.content,
        }));

        const systemPrompt = [
            "You are a hospitality operations analyst creating executive-ready reports from AI analysis records.",
            "Return valid JSON only.",
            "Write a structured report with: title, executiveSummary, keyFindings, categoryBreakdown, departmentBreakdown, priorityBreakdown, notableReservations, risks, actions, recommendations, methodologyNote.",
            "Keep breakdown arrays concise and factual.",
            "Use the provided records snapshot as the source of truth.",
        ].join(" ");

        const userPrompt = JSON.stringify({
            threadName,
            currentInstruction: history[history.length - 1]?.content || "",
            priorMessages: recentHistory,
            datasetSnapshot: snapshot,
        });

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4.1",
                temperature: 0.2,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
            });
            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error("No response from OpenAI");
            }
            return this.parseStructuredReport(content, snapshot);
        } catch (error: any) {
            logger.error("[GuestAnalysisReportThreadService] Report generation failed", error?.message || error);
            return this.buildFallbackReport(snapshot, history[history.length - 1]?.content || "");
        }
    }

    private parseStructuredReport(content: string, snapshot: GuestAnalysisReportSnapshot): AIAnalysisStructuredReport {
        const parsed = JSON.parse(content) as Partial<AIAnalysisStructuredReport>;
        return {
            title: String(parsed.title || "AI Analysis Report"),
            executiveSummary: String(parsed.executiveSummary || "No executive summary provided."),
            keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings.map((item) => String(item)) : [],
            categoryBreakdown: Array.isArray(parsed.categoryBreakdown) ? parsed.categoryBreakdown.map((item: any) => ({
                label: String(item?.label || ""),
                count: Number(item?.count || 0),
                detail: item?.detail ? String(item.detail) : undefined,
            })).filter((item) => item.label) : [],
            departmentBreakdown: Array.isArray(parsed.departmentBreakdown) ? parsed.departmentBreakdown.map((item: any) => ({
                label: String(item?.label || ""),
                count: Number(item?.count || 0),
                detail: item?.detail ? String(item.detail) : undefined,
            })).filter((item) => item.label) : [],
            priorityBreakdown: Array.isArray(parsed.priorityBreakdown) ? parsed.priorityBreakdown.map((item: any) => ({
                label: String(item?.label || ""),
                count: Number(item?.count || 0),
                detail: item?.detail ? String(item.detail) : undefined,
            })).filter((item) => item.label) : [],
            notableReservations: Array.isArray(parsed.notableReservations) ? parsed.notableReservations.map((item: any) => ({
                reservationId: Number(item?.reservationId || 0),
                guestName: item?.guestName ? String(item.guestName) : null,
                listingName: item?.listingName ? String(item.listingName) : null,
                bookingPhase: String(item?.bookingPhase || ""),
                summary: String(item?.summary || ""),
                priority: String(item?.priority || ""),
                status: String(item?.status || ""),
            })).filter((item) => item.reservationId) : [],
            risks: Array.isArray(parsed.risks) ? parsed.risks.map((item) => String(item)) : [],
            actions: Array.isArray(parsed.actions) ? parsed.actions.map((item) => String(item)) : [],
            recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map((item) => String(item)) : [],
            methodologyNote: parsed.methodologyNote ? String(parsed.methodologyNote) : `Based on ${snapshot.totalRecords} filtered AI analysis records.`,
        };
    }

    private buildFallbackReport(snapshot: GuestAnalysisReportSnapshot, instruction: string): AIAnalysisStructuredReport {
        const countLabels = (values: string[]) => {
            const counts = new Map<string, number>();
            values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
            return Array.from(counts.entries())
                .map(([label, count]) => ({ label, count }))
                .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
                .slice(0, 5);
        };

        return {
            title: instruction ? `AI Report: ${instruction.slice(0, 60)}` : "AI Analysis Report",
            executiveSummary: `This report is based on ${snapshot.totalRecords} AI analysis records matching the selected filters.`,
            keyFindings: [
                `Filtered dataset contains ${snapshot.totalRecords} records.`,
                `Top categories: ${countLabels(snapshot.records.flatMap((record) => record.categories)).map((item) => `${item.label} (${item.count})`).join(", ") || "none"}.`,
                `Top departments: ${countLabels(snapshot.records.flatMap((record) => record.departments)).map((item) => `${item.label} (${item.count})`).join(", ") || "none"}.`,
            ],
            categoryBreakdown: countLabels(snapshot.records.flatMap((record) => record.categories)),
            departmentBreakdown: countLabels(snapshot.records.flatMap((record) => record.departments)),
            priorityBreakdown: countLabels(snapshot.records.map((record) => record.priority)),
            notableReservations: snapshot.records.slice(0, 5).map((record) => ({
                reservationId: record.reservationId,
                guestName: record.guestName,
                listingName: record.listingName,
                bookingPhase: record.bookingPhase,
                summary: record.summary,
                priority: record.priority,
                status: record.status,
            })),
            risks: snapshot.records.filter((record) => record.status === "Action needed").slice(0, 3).map((record) => `${record.listingName || "Unknown property"}: ${record.summary}`),
            actions: ["Review high-priority items first.", "Inspect repeated categories by department ownership."],
            recommendations: ["Use this dataset snapshot as the basis for leadership review and follow-up planning."],
            methodologyNote: `Fallback report generated from the exact filtered dataset snapshot (${snapshot.totalRecords} records).`,
        };
    }
}
