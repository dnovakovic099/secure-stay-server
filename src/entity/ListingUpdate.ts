import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('listing_updates')
export class ListingUpdateEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ type: "int", nullable: false })
    listingId: number;

    @Column({ type: 'varchar' })
    date: string;

    @Column({ type: 'text' })
    action: string;

    @Column()
    userId: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}