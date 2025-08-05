import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, DeleteDateColumn, UpdateDateColumn } from "typeorm";

@Entity("listing_schedule")
export class ListingSchedule {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    listingId: number;

    @Column({ nullable: true })
    workCategory: string;

    @Column({ nullable: true })
    scheduleType: string;

    @Column({ nullable: true })
    intervalMonth: number;

    @Column({ nullable: true })
    dayOfWeek: string;

    @Column({ nullable: true })
    weekOfMonth: number;

    @Column({ nullable: true })
    dayOfMonth: number;

    @Column({ nullable: true })
    scheduling: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true })
    deletedBy: string;
}
