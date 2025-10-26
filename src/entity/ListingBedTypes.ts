import {
    Entity,
    Column,
    ManyToOne,
    JoinColumn,
    PrimaryColumn,
    PrimaryGeneratedColumn,
} from "typeorm";

import { Listing } from "./Listing";

@Entity("listing_bed_types")
export class ListingBedTypes {
    @PrimaryGeneratedColumn()
    listing_bed_type_id: number;

    @Column()
    id: number;

    @Column({ nullable: true })
    bedTypeId: number;

    @Column({ nullable: true })
    quantity: number;

    @Column({ nullable: true })
    bedroomNumber: number;

    @ManyToOne(() => Listing, (listing) => listing.listingBedTypes, {
        onDelete: "CASCADE"
    })

    @JoinColumn({ name: "listing_id" })
    listing: number;
}