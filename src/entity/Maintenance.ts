import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';

@Entity('maintenance')
export class Maintenance {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column()
    listingId: string;

    @Column({ nullable: true })
    workCategory: string;

    @Column({ nullable: true })
    nextSchedule: string;

    @Column({ type: "text", nullable: true })
    notes: string;

    @Column({ nullable: true })
    contactId: number;

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