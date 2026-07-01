import {
    Entity,
    PrimaryColumn,
    Column,
    Index,
    CreateDateColumn,
    UpdateDateColumn,
} from "typeorm";

/**
 * ListingGroupMap
 *
 * Hostify splits ONE physical property into several listing IDs — one per sales
 * channel (Airbnb, Booking.com, Vrbo, direct/"Own") — linked by a parent/child
 * relationship. Inbox conversations arrive on the channel (child) listing ID,
 * while our Knowledge Base and most seeded data live on the parent ID, so the
 * bot would look up the child ID, find nothing, and guess.
 *
 * This table maps every known listing ID to a single canonical "group" ID (its
 * parent, or itself when it is the parent) so the assistant can gather knowledge
 * across all siblings of the same real property — e.g. "Rogers - Airbnb",
 * "Rogers - Bcom", "Rogers - Vrbo" all resolve to one Rogers group.
 */
@Entity("listing_group_map")
export class ListingGroupMapEntity {
    @PrimaryColumn({ type: "bigint" })
    listingId: number;

    @Index()
    @Column({ type: "bigint" })
    groupId: number;

    @Column({ length: 255, nullable: true })
    name: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
