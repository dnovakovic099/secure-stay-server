import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('hostaway_user')
export class HostawayUser {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column()
    ha_userId: number;

    @Column()
    listingId: number;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}