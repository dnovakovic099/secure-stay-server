import OpenAI from "openai";
import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { GuestAnalysisEntity, GuestAnalysisFlag } from "../entity/GuestAnalysis";
import { GuestCommunicationEntity } from "../entity/GuestCommunication";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { GuestCommunicationService } from "./GuestCommunicationService";
import logger from "../utils/logger.utils";
import { v4 as uuidv4 } from "uuid";

/**
 * Sentiment types for guest analysis
 */
export type SentimentType = "Positive" | "Neutral" | "Negative" | "Mixed";

/**
 * Flag types for operational issues
 */
export const FLAG_TYPES = [
    "Delayed Response",
    "Missed or Incomplete Response",
    "Incorrect or Conflicting Information",
    "Poor or Unclear Communication Tone",
    "Escalation Needed"
] as const;

export type FlagType = typeof FLAG_TYPES[number];

/**
 * AI analysis result interface
 */
export interface GuestAnalysisResult {
    summary: string;
    sentiment: SentimentType;
    sentimentReason: string;
    flags: GuestAnalysisFlag[];
}

/**
 * GuestAnalysisService
 * Generates AI-powered analysis of guest-host communications
 */
export class GuestAnalysisService {
    private openai: OpenAI;
    private analysisRepo = appDatabase.getRepository(GuestAnalysisEntity);
    private reservationRepo = appDatabase.getRepository(ReservationInfoEntity);
    private communicationService: GuestCommunicationService;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is not set in environment variables");
        }
        this.openai = new OpenAI({ apiKey });
        this.communicationService = new GuestCommunicationService();
    }

    /**
     * Analyze guest communications for a reservation
     * Fetches data from all sources and generates AI analysis
     */
    async analyzeGuestCommunication(
        reservationId: number,
        inboxId?: string
    ): Promise<GuestAnalysisEntity> {
        logger.info(`[GuestAnalysisService] Starting analysis for reservation ${reservationId}`);

        // Fetch communications from OpenPhone
        await this.communicationService.fetchAndStoreFromOpenPhone(reservationId);

        // Fetch communications from Hostify (inboxId will be discovered if not provided)
        await this.communicationService.fetchAndStoreFromHostify(reservationId, inboxId);

        // Build timeline for AI
        const timeline = await this.communicationService.buildCommunicationTimeline(reservationId);

        // Get reservation info for context
        const reservation = await this.reservationRepo.findOne({
            where: { id: reservationId }
        });

        // Get communication IDs
        const communications = await this.communicationService.getAllCommunicationsForReservation(reservationId);
        const communicationIds = communications.map(c => c.id);

        // Generate AI analysis
        const result = await this.generateAnalysis(timeline, reservation);

        // Check for existing analysis
        let analysis = await this.analysisRepo.findOne({
            where: { reservationId }
        });

        if (analysis) {
            // Update existing
            analysis.summary = result.summary;
            analysis.sentiment = result.sentiment;
            analysis.sentimentReason = result.sentimentReason;
            analysis.flags = result.flags;
            analysis.analyzedAt = new Date();
            analysis.analyzedBy = "manual";
            analysis.communicationIds = communicationIds;
        } else {
            // Create new
            analysis = this.analysisRepo.create({
                id: uuidv4(),
                reservationId,
                summary: result.summary,
                sentiment: result.sentiment,
                sentimentReason: result.sentimentReason,
                flags: result.flags,
                analyzedAt: new Date(),
                analyzedBy: "manual",
                communicationIds
            });
        }

        const saved = await this.analysisRepo.save(analysis);
        logger.info(`[GuestAnalysisService] Analysis saved for reservation ${reservationId}`);
        return saved;
    }

    /**
     * Get existing analysis for a reservation
     */
    async getAnalysisByReservation(reservationId: number): Promise<GuestAnalysisEntity | null> {
        return this.analysisRepo.findOne({
            where: { reservationId }
        });
    }

    /**
     * Get existing analyses for a list of reservations
     */
    async getAnalysesByReservations(reservationIds: number[]): Promise<GuestAnalysisEntity[]> {
        if (reservationIds.length === 0) return [];
        return this.analysisRepo.find({
            where: { reservationId: In(reservationIds) }
        });
    }

    /**
     * Regenerate analysis for a reservation
     */
    async regenerateAnalysis(reservationId: number, inboxId?: string): Promise<GuestAnalysisEntity> {
        return this.analyzeGuestCommunication(reservationId, inboxId);
    }

    /**
     * Process scheduled AI analysis for today's checkout reservations
     * This is called by the daily scheduler at 6:15 AM EST
     */
    async processScheduledAnalysis(): Promise<{ processed: number; failed: number; skipped: number; }> {
        const { ReservationInfoService } = await import('./ReservationInfoService');
        const reservationInfoService = new ReservationInfoService();

        logger.info('[GuestAnalysisService] Scheduled analysis started - fetching today\'s checkouts...');

        const { reservations } = await reservationInfoService.getCheckoutReservations();
        logger.info(`[GuestAnalysisService] Found ${reservations.length} checkout reservations to analyze`);

        let processed = 0;
        let failed = 0;
        let skipped = 0;

        for (const reservation of reservations) {
            try {
                // Check if analysis already exists and was done recently (within last 24 hours)
                const existing = await this.getAnalysisByReservation(reservation.id);
                if (existing && existing.analyzedAt) {
                    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    if (existing.analyzedAt > twentyFourHoursAgo) {
                        logger.info(`[GuestAnalysisService] Skipping reservation ${reservation.id} - recent analysis exists`);
                        skipped++;
                        continue;
                    }
                }

                logger.info(`[GuestAnalysisService] Processing reservation ${reservation.id} (${reservation.guestName})`);
                await this.analyzeGuestCommunication(reservation.id);
                processed++;
            } catch (error: any) {
                logger.error(`[GuestAnalysisService] Failed to analyze reservation ${reservation.id}: ${error.message}`);
                failed++;
            }
        }

        logger.info(`[GuestAnalysisService] Scheduled analysis complete - Processed: ${processed}, Failed: ${failed}, Skipped: ${skipped}`);
        return { processed, failed, skipped };
    }

    /**
     * Generate AI analysis from communication timeline
     */
    private async generateAnalysis(
        timeline: string,
        reservation: ReservationInfoEntity | null
    ): Promise<GuestAnalysisResult> {
        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(timeline, reservation);

        const response = await this.openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            throw new Error("No response from OpenAI");
        }

        try {
            const parsed = JSON.parse(content) as GuestAnalysisResult;

            // Validate sentiment
            if (!["Positive", "Neutral", "Negative", "Mixed"].includes(parsed.sentiment)) {
                parsed.sentiment = "Neutral";
            }

            // Validate flags
            if (!Array.isArray(parsed.flags)) {
                parsed.flags = [];
            }

            return parsed;
        } catch (error) {
            logger.error("[GuestAnalysisService] Error parsing AI response:", error);
            throw new Error("Failed to parse AI analysis response");
        }
    }

    /**
     * Build system prompt for AI analysis
     */
    private buildSystemPrompt(): string {
        return `You are an expert hospitality communication analyst for a vacation rental management company. Your role is to analyze guest-host communication data and produce structured internal insights.

## YOUR TASK
Analyze the provided guest communication timeline and generate:
1. An AI-generated interaction summary
2. An overall standardized sentiment
3. Operational flags highlighting issues

## OUTPUT FORMAT
Respond in valid JSON with this structure:
{
    "summary": "Concise, neutral summary covering guest concerns, rep actions, outcomes, escalations",
    "sentiment": "Positive" | "Neutral" | "Negative" | "Mixed",
    "sentimentReason": "1-2 line explanation of sentiment classification",
    "flags": [
        {"flag": "Flag Type", "explanation": "Brief explanation"}
    ]
}

## SUMMARY RULES
- Be concise and neutral
- Cover: guest concerns, rep actions, outcomes, escalations
- Do NOT add assumptions
- Do NOT repeat message content verbatim
- Do NOT include internal system names

## SENTIMENT LABELS (use exactly one)
- Positive: Guest expressed satisfaction, gratitude, or resolved issues happily
- Neutral: Standard transactional communication without strong emotion
- Negative: Guest expressed frustration, complaints, or dissatisfaction
- Mixed: Communication contains both positive and negative elements

## FLAG TYPES (use only these)
- Delayed Response: Representative took too long to respond
- Missed or Incomplete Response: Guest question/request not addressed
- Incorrect or Conflicting Information: Rep provided wrong or contradictory info
- Poor or Unclear Communication Tone: Rep's tone was unprofessional or confusing
- Escalation Needed: Situation requires management attention

If no issues found, return empty flags array: []`;
    }

    /**
     * Build user prompt with timeline and context
     */
    private buildUserPrompt(timeline: string, reservation: ReservationInfoEntity | null): string {
        let prompt = "## GUEST COMMUNICATION DATA\n\n";

        if (reservation) {
            prompt += "### Reservation Context\n";
            prompt += `- Guest Name: ${reservation.guestName || "Unknown"}\n`;
            prompt += `- Listing: ${reservation.listingName || "Unknown"}\n`;
            prompt += `- Check-in: ${reservation.arrivalDate || "Unknown"}\n`;
            prompt += `- Check-out: ${reservation.departureDate || "Unknown"}\n`;
            prompt += `- Channel: ${reservation.channelName || "Unknown"}\n\n`;
        }

        prompt += timeline;
        prompt += "\n\n## INSTRUCTIONS\nAnalyze the above communication timeline and provide the JSON analysis.";

        return prompt;
    }
}
