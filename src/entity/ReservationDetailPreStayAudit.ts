import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export enum CompletionStatus {
    NOT_STARTED = 'Not Started',
    IN_PROGRESS = 'In Progress',
    COMPLETED = 'Completed'
}

export enum DoorCodeStatus {
    SET = 'set',
    ISSUE = 'issue',
    UNSET = 'unset'
}


export enum InventoryCheckStatus {
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}



export enum CleanlinessCheck {
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}


export enum CleanerCheck {
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}


export enum CleanerNotified {
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}

export enum DamageCheck {
    YES = 'yes',
    NO = 'no',
    UNSET = 'unset'
}

@Entity('reservation_detail_pre_stay_audit')
export class ReservationDetailPreStayAudit {
    @PrimaryColumn({ type: 'bigint' })
    reservationId: number;

    @Column({
        type: "enum",
        enum: DoorCodeStatus,
        default: DoorCodeStatus.UNSET
    })
    doorCode: DoorCodeStatus;

    @Column({ 
        type: 'text',
        nullable: true 
    })
    amenitiesConfirmed: string;

    @Column({
        type: "enum",
        enum: CompletionStatus,
        default: CompletionStatus.NOT_STARTED
    })
    completionStatus: CompletionStatus;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true , type: 'text' })
    attachments: string;


    @Column({ nullable: true })
    wifiConnectedAndActive: boolean;

    @Column({
        type: "enum",
        enum: InventoryCheckStatus,
        default: InventoryCheckStatus.UNSET,
        nullable: true
    })
    inventoryCheckStatus: InventoryCheckStatus;

    @Column({
        type: "enum",
        enum: CleanlinessCheck,
        default: CleanlinessCheck.UNSET,
        nullable: true
    })
    cleanlinessCheck: CleanlinessCheck;

    @Column({
        type: "enum",
        enum: CleanerCheck,
        default: CleanerCheck.UNSET,
        nullable: true
    })
    cleanerCheck: CleanerCheck;

    @Column({
        type: "enum",
        enum: CleanerNotified,
        default: CleanerNotified.UNSET,
        nullable: true
    })
    cleanerNotified: CleanerNotified;

    @Column({
        type: "enum",
        enum: DamageCheck,
        default: DamageCheck.UNSET,
        nullable: true
    })
    damageCheck: DamageCheck;
    
    @Column({ nullable: true, type: 'text' })
    approvedUpsells: string;





}