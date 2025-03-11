import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, JoinColumn } from "typeorm";
import { ReservationDetail } from "./ReservationDetail";

@Entity("reservation_cleaner_photos")
export class ReservationCleanerPhoto {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: false })
    photoName: string;

    @ManyToOne(() => ReservationDetail, reservation => reservation.cleanerPhotos, { nullable: false })
    @JoinColumn({ name: "reservationId" })
    reservation: ReservationDetail;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}