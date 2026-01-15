import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export enum CompletionStatus {
    NOT_STARTED = 'Not Started',
    IN_PROGRESS = 'In Progress',
    COMPLETED = 'Completed'
}

export enum PotentialReviewIssue {
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}

export enum DamageReport{
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}


export enum MissingItems{
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}

export enum UtilityIssues{
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}

export enum KeysAndLocks {
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}

export enum GuestBookCheck {
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}

export enum SecurityDepositStatus {
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}

@Entity('reservation_detail_post_stay_audit')
export class ReservationDetailPostStayAudit {
    @PrimaryColumn({ type: 'bigint' })
    reservationId: number;

    @Column({ 
        type: 'text',
        nullable: true 
    })
    maintenanceIssues: string;

    @Column({ 
        type: 'text',
        nullable: true 
    })
    cleaningIssues: string;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 0
    })
    cleaningSupplies: number;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 0
    })
    refundForReview: number;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 0
    })
    airbnbReimbursement: number;

    @Column({
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 0
    })
    luxuryLodgingReimbursement: number;

    @Column({
        type: "enum",
        enum: PotentialReviewIssue,
        default: PotentialReviewIssue.UNSET
    })
    potentialReviewIssue: PotentialReviewIssue;

    @Column({
        type: "enum",
        enum: CompletionStatus,
        default: CompletionStatus.NOT_STARTED
    })
    completionStatus: CompletionStatus;

    @Column({
        type: "enum",
        enum: DamageReport,
        default: DamageReport.UNSET,
        nullable: true
    })
    damageReport: DamageReport;

    @Column({
        type: 'text',
        nullable: true
    })
    damageReportNotes: string;

    @Column({
        type: "enum",
        enum: MissingItems,
        default: MissingItems.UNSET,
        nullable: true
    })
    missingItems: MissingItems;

    @Column({
        type: 'text',
        nullable: true
    })
    missingItemsNotes: string;

    @Column({
        type: "enum",
        enum: UtilityIssues,
        default: UtilityIssues.UNSET,
        nullable: true
    })
    utilityIssues: UtilityIssues;

    @Column({
        type: "enum",
        enum: KeysAndLocks,
        default: KeysAndLocks.UNSET,
        nullable: true
    })
    keysAndLocks: KeysAndLocks;

    @Column({
        type: "enum",
        enum: GuestBookCheck,
        default: GuestBookCheck.UNSET,
        nullable: true
    })
    guestBookCheck: GuestBookCheck;

    @Column({
        type: "enum",
        enum: SecurityDepositStatus,
        default: SecurityDepositStatus.UNSET,
        nullable: true
    })
    securityDepositStatus: SecurityDepositStatus;

    @Column({ nullable: true , type: 'text' })
    attachments: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true, type: 'text' })
    approvedUpsells: string;

    @Column({ type: "text", nullable: true })
    reasonForMissingIssue: string;

    @Column({ type: "text", nullable: true })
    improvementSuggestion: string;

    @Column({ nullable: true })
    cleanerNotificationContactId: number;

    @Column({
        type: "enum",
        enum: ["pending", "sent", "failed", "skipped"],
        nullable: true
    })
    cleanerNotificationStatus: string;

    @Column({ type: 'timestamp', nullable: true })
    cleanerNotificationSentAt: Date;

    @Column({ type: "text", nullable: true })
    cleanerNotificationError: string;
} 