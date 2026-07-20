import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * Staff overrides / quarantine for contested listing facts the AI must not
 * invent from raw Hostify / listing_info when ops practice differs.
 *
 * status:
 *  - "active": value is authoritative for this field
 *  - "quarantined": do NOT assert PMS/listing_info for this field; escalate
 */
@Entity("listing_ops_overrides")
export class ListingOpsOverrideEntity {
    @PrimaryGeneratedColumn() id: number;

    @Index()
    @Column({ type: "bigint" })
    listingId: number;

    /** checkout_time | checkin_time | capacity | early_checkin_fee | late_checkout_fee */
    @Index()
    @Column({ length: 64 })
    field: string;

    /** Normalized value e.g. "11", "16", "100.00" — null when quarantined with no replacement */
    @Column({ type: "varchar", length: 120, nullable: true })
    value: string | null;

    @Column({ length: 20, default: "active" })
    status: string;

    @Column({ type: "varchar", length: 500, nullable: true })
    note: string | null;

    @Column({ type: "int", nullable: true })
    createdByUserId: number | null;

    @CreateDateColumn({ type: "timestamp" }) createdAt: Date;
    @UpdateDateColumn({ type: "timestamp" }) updatedAt: Date;
}
