import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type ReviewReportTemplateType =
    | "executive_weekly"
    | "operations_deep_dive"
    | "negotiation_review";

export type ReviewReportGenerationType =
    | "generated"
    | "revised"
    | "regenerated"
    | "section_regenerated"
    | "manual_edit";

export type ReviewReportSectionKey =
    | "executive_summary"
    | "review_performance"
    | "operational_failures"
    | "negotiation_performance"
    | "action_plan"
    | "category_department_breakdown"
    | "notable_reservations"
    | "coaching_opportunities";

export interface ReviewReportFilters {
    fromDate?: string | null;
    toDate?: string | null;
    dateType?: "departureDate" | "arrivalDate";
    listingId?: number[];
    propertyType?: string[];
    channel?: Array<string | number>;
    serviceType?: string[];
}

export interface ReviewReportSection {
    key: ReviewReportSectionKey;
    title: string;
    content: string;
    edited?: boolean;
    editedBy?: string | null;
    editedAt?: string | null;
}

export interface ReviewReportChatMessage {
    role: "user" | "assistant";
    content: string;
    targetSectionKey?: ReviewReportSectionKey | null;
    createdAt: string;
}

export interface ReviewReportDocument {
    title: string;
    subtitle: string;
    templateType: ReviewReportTemplateType;
    filters: ReviewReportFilters;
    cohort: {
        totalReservations: number;
        reviewedReservations: number;
        fiveStarReviews: number;
        belowFiveStarReviews: number;
        noReviewReservations: number;
        averageRating: number | null;
        propertyTypeBreakdown: Array<{ label: string; count: number }>;
        channelBreakdown: Array<{ label: string; count: number }>;
        aiRefresh: {
            attempted: number;
            succeeded: number;
            failed: number;
        };
        warnings: string[];
        comparison?: {
            label: string;
            totalReservations: number;
            reviewedReservations: number;
            fiveStarReviews: number;
            belowFiveStarReviews: number;
            averageRating: number | null;
        } | null;
    };
    sections: ReviewReportSection[];
}

@Entity("review_reports")
export class ReviewReportEntity {
    @PrimaryColumn({ type: "varchar", length: 36 })
    id: string;

    @Column({ length: 180 })
    name: string;

    @Column({ length: 64 })
    templateType: ReviewReportTemplateType;

    @Column("json")
    filters: ReviewReportFilters;

    @Column("json", { nullable: true })
    chatHistory: ReviewReportChatMessage[] | null;

    @Column({ length: 36, nullable: true })
    linkedAiThreadId: string | null;

    @Column({ type: "int", default: 1 })
    currentVersionNumber: number;

    @Column({ length: 120, nullable: true })
    createdBy: string | null;

    @Column({ length: 120, nullable: true })
    updatedBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

@Entity("review_report_versions")
export class ReviewReportVersionEntity {
    @PrimaryColumn({ type: "varchar", length: 36 })
    id: string;

    @Column({ length: 36 })
    reportId: string;

    @Column({ type: "int" })
    versionNumber: number;

    @Column({ length: 48 })
    generationType: ReviewReportGenerationType;

    @Column({ length: 64, nullable: true })
    targetSectionKey: ReviewReportSectionKey | null;

    @Column("longtext", { nullable: true })
    instruction: string | null;

    @Column("json")
    document: ReviewReportDocument;

    @Column({ length: 120, nullable: true })
    createdBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
