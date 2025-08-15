import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('generic_report')
export class GenericReport {
    @PrimaryGeneratedColumn()
    id: number;

    // e.g., "reservation_count", "revenue_summary", "cancellation_rate"
    @Column()
    reportType: string;

    // e.g., "year", "month", "channel", "status"
    @Column({ nullable: true })
    dimension1: string;

    @Column({ nullable: true })
    dimension2: string;

    // Year/Month can still be stored for time-based reports
    @Column({ nullable: true })
    year: string;

    @Column({ nullable: true })
    month: string;

    // For numerical values (count, revenue, percentage, etc.)
    @Column({ type: "int" })
    value: number;

    @Column({ type: "int", nullable: true })
    listingId: number;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}
