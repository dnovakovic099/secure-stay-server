import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn
} from "typeorm";
import { Listing } from "./Listing";

@Entity("listing_change_log")
export class ListingChangeLog {
    @PrimaryGeneratedColumn({ type: "bigint" })
    id: number;

    @Column({ type: "bigint" })
    listingId: number;

    @Column({ type: "bigint", nullable: true })
    hostifyListingId: number | null;

    @CreateDateColumn({ type: "timestamp" })
    changedAt: Date;

    @Column({ type: "varchar", length: 255, default: "Hostify Sync" })
    changedBy: string;

    @Column({ type: "json" })
    diff: Array<{ field: string; old: any; new: any }>;

    @Column({ type: "varchar", length: 255 })
    source: string;

    @ManyToOne(() => Listing, { onDelete: "CASCADE" })
    @JoinColumn({ name: "listingId" })
    listing: Listing;
}
