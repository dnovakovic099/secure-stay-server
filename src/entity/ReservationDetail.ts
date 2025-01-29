import { Entity, PrimaryColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { ReservationCleanerPhoto } from "./ReservationCleanerPhoto";

export enum DoorCodeStatus {
    SET = 'set',
    ISSUE = 'issue',
    UNSET = 'unset'
}

export enum ReviewMediationStatus {
    UNSET = 'unset',
    NOT_STARTED = 'not started',
    IN_PROGRESS = 'in progress',
    STUCK = 'stuck'
}

@Entity("reservation_details")
export class ReservationDetail {
    @PrimaryColumn()
    reservationId: string;

    @Column({
        type: "enum",
        enum: DoorCodeStatus,
        default: DoorCodeStatus.UNSET
    })
    doorCode: DoorCodeStatus;

    @Column({ type: "text", nullable: true })
    additionalNotes: string;

    @Column({
        type: "enum",
        enum: ReviewMediationStatus,
        default: ReviewMediationStatus.UNSET
    })
    reviewMediationStatus: ReviewMediationStatus;

    @Column({ type: "text", nullable: true })
    specialRequest: string;

    @OneToMany(() => ReservationCleanerPhoto, photo => photo.reservation)
    cleanerPhotos: ReservationCleanerPhoto[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}