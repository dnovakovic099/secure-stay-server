import {
    Entity,
    Column,
    ManyToOne,
    JoinColumn,
    PrimaryColumn,
    PrimaryGeneratedColumn,
} from "typeorm";

import { Listing } from "./Listing";

@Entity("listing_amenities")
export class ListingAmenities {
    @PrimaryGeneratedColumn()
    listing_amenity_id: number;

    @Column({ type: "bigint" })
    id: number;

    @Column({ nullable: true })
    amenityId: number;

    @Column({ nullable: true })
    amenityName: string;

    @Column({ type: "text", nullable: true })
    description: string;

    @ManyToOne(() => Listing, (listing) => listing.listingAmenities, {
        onDelete: "CASCADE"
    })
    listing: Listing;
}