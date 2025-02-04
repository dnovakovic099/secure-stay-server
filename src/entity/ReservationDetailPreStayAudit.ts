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
}