import { Entity, PrimaryColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { ReservationCleanerPhoto } from "./ReservationCleanerPhoto";

export enum ReviewMediationStatus {
    UNSET = 'unset',
    NOT_STARTED = 'not started',
    IN_PROGRESS = 'in progress',
    STUCK = 'stuck'
}

@Entity("reservation_details")
export class ReservationDetail {
    @PrimaryColumn({ type: 'bigint' })
    reservationId: number;

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

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}