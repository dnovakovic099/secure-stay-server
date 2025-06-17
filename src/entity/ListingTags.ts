import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
} from "typeorm";

import { Listing } from "./Listing";

@Entity("listing_tags")
export class ListingTags {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    tagId: number;

    @Column({ nullable: true })
    name: string;

    @ManyToOne(() => Listing, (listing) => listing.listingTags, {
        onDelete: "CASCADE"
    })

    @JoinColumn({ name: "listing_id" })
    listing: number;
}
