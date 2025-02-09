import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('owner_info')
export class OwnerInfoEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column()
    listingId: number;

    @Column({ nullable: true })
    ownerName: string;

    @Column({ nullable: true })
    ownerEmail: string;

    @Column({ nullable: true })
    ownerPhone: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}