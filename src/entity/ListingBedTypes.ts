import {
    Entity,
    Column,
    ManyToOne,
    JoinColumn,
    PrimaryColumn,
} from "typeorm";

import { Listing } from "./Listing";

@Entity("listing_bed_types")
export class ListingBedTypes {
    @PrimaryColumn({ type: "bigint" })
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