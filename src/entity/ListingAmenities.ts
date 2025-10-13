import {
    Entity,
    Column,
    ManyToOne,
    JoinColumn,
    PrimaryColumn,
} from "typeorm";

import { Listing } from "./Listing";

@Entity("listing_amenities")
export class ListingAmenities {
    @PrimaryColumn({ type: "bigint" })
    id: number;

    @Column({ nullable: true })
    amenityId: number;

    @Column({ nullable: true })
    amenityName: string;

    @ManyToOne(() => Listing, (listing) => listing.listingAmenities, {
        onDelete: "CASCADE"
    })

    @JoinColumn({ name: "listing_id" })
    listing: number;
}