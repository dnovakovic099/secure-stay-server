import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { GuestAnalysisRecordFilters } from "../services/GuestAnalysisService";

export interface GuestAnalysisReportSnapshotRecord {
    id: string;
    reservationId: number;
    guestName: string | null;
    listingName: string | null;
    arrivalDate: Date | string | null;
    departureDate: Date | string | null;
    bookingPhase: string;
    sentiment: string;
    summary: string;
    categories: string[];
    departments: string[];
    priority: string;
    status: string;
    flagCount: number;
}

export interface AIAnalysisStructuredReport {
    title: string;
    executiveSummary: string;
    keyFindings: string[];
    categoryBreakdown: Array<{ label: string; count: number; detail?: string }>;
    departmentBreakdown: Array<{ label: string; count: number; detail?: string }>;
    priorityBreakdown: Array<{ label: string; count: number; detail?: string }>;
    notableReservations: Array<{
        reservationId: number;
        guestName: string | null;
        listingName: string | null;
        bookingPhase: string;
        summary: string;
        priority: string;
        status: string;
    }>;
    risks: string[];
    actions: string[];
    recommendations: string[];
    methodologyNote?: string | null;
}

export interface GuestAnalysisReportSnapshot {
    generatedAt: string;
    filters: GuestAnalysisRecordFilters;
    totalRecords: number;
    records: GuestAnalysisReportSnapshotRecord[];
}

export type GuestAnalysisReportMessageRole = "user" | "assistant";

@Entity("guest_analysis_report_threads")
export class GuestAnalysisReportThreadEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ length: 180 })
    name: string;

    @Column({ length: 120, nullable: true })
    createdBy: string | null;

    @Column("json", { nullable: true })
    latestFilters: GuestAnalysisRecordFilters | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

@Entity("guest_analysis_report_messages")
export class GuestAnalysisReportMessageEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ length: 36 })
    threadId: string;

    @Column({ length: 16 })
    role: GuestAnalysisReportMessageRole;

    @Column("longtext")
    content: string;

    @Column("json", { nullable: true })
    filterSnapshot: GuestAnalysisRecordFilters | null;

    @Column("json", { nullable: true })
    datasetSnapshot: GuestAnalysisReportSnapshot | null;

    @Column("json", { nullable: true })
    structuredReport: AIAnalysisStructuredReport | null;

    @Column({ length: 120, nullable: true })
    createdBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
