import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('partnership_info')
export class PartnershipInfoEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column()
    listingId: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, default: 0 })
    totalEarned: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, default: 0 })
    pendingCommission: number;

    @Column({ type: "integer", default: 0, nullable: true })
    activeReferral: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, default: 0 })
    yearlyProjection: number;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}