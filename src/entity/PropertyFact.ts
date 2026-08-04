import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";

/**
 * property_facts — the Verified Property Facts layer.
 *
 * One row per (canonical listing, preset field). Highest authority in the AI
 * prompt: a VERIFIED value overrides listing descriptions, KB entries and
 * learned facts. Rows are keyed to the canonical (group parent) listing id so
 * all per-channel child listings share the same facts.
 *
 * status:
 *   unverified — prefilled from Hostify/intake/upsells; shown in the UI for
 *                review but NOT asserted to guests as certain.
 *   verified   — a human confirmed it; the AI may state it as fact.
 */
@Entity("property_facts")
@Index(["listingId", "fieldKey"], { unique: true })
export class PropertyFactEntity {
    @PrimaryGeneratedColumn() id: number;

    /** Canonical (group parent) listing id. */
    @Index() @Column({ type: "bigint" }) listingId: number;

    @Column({ length: 64 }) fieldKey: string;

    @Column({ type: "text", nullable: true }) value: string | null;

    /**
     * Strict, normalized value used only by the Hostify listing update.
     * Kept separate from `value`, which remains the free-text fact/AI notes.
     */
    @Column({ type: "varchar", length: 64, nullable: true }) hostifyValue: string | null;

    /** Staff-only guidance for the AI; never guest-shareable content. */
    @Column({ type: "text", nullable: true }) internalInstructions: string | null;

    @Index() @Column({ length: 16, default: "unverified" }) status: string;

    /** Where the current value came from: hostify | intake | upsells | parking | correction | manual */
    @Column({ length: 32, default: "manual" }) source: string;

    @Column({ type: "bigint", nullable: true }) verifiedByUserId: number | null;

    @Column({ type: "datetime", nullable: true }) verifiedAt: Date | null;

    @Column({ type: "bigint", nullable: true }) updatedByUserId: number | null;

    @CreateDateColumn({ type: "timestamp" }) createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" }) updatedAt: Date;
}
