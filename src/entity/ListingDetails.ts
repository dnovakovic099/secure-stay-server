import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity("listing_details")
export class ListingDetail {
    @PrimaryGeneratedColumn({ name: "id" })
    id: number;

    @Column({ type: "int", nullable: false })
    listingId: number;

    @Column({ nullable: false })
    propertyOwnershipType: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

}
