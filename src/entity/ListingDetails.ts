import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity("listing_details")
export class ListingDetail {
    @PrimaryGeneratedColumn({ name: "id" })
    id: number;

    @Column({ type: "int", nullable: false })
    listingId: number;

    @Column({ nullable: false })
    propertyOwnershipType: string;

    @Column({ nullable: true })
    statementDurationType: string;

    @Column({ default: false, nullable: true })
    claimProtection: boolean;

    @Column({default: false, nullable:true})
    hidePetFee: boolean;

    @Column({ name: 'tech_fee', default: false, nullable: true })
    techFee: boolean;

    @Column({ name: 'tech_fee_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
    techFeeAmount: number;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

}
