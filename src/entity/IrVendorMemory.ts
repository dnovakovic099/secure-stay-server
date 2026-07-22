import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * Portfolio/city vendor memory for IR Copilot.
 * Aggregated from completed issues + contacts; taught by human answers/feedback.
 */
@Entity("ir_vendor_memory")
@Index("uq_ir_vendor_memory_city_cat_name", ["city", "category", "normalizedName"], { unique: true })
export class IrVendorMemoryEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 255 })
    vendorName: string;

    @Index()
    @Column({ length: 255 })
    normalizedName: string;

    @Column({ length: 64, nullable: true })
    phone: string | null;

    @Column({ length: 255, nullable: true })
    email: string | null;

    @Index()
    @Column({ length: 128, nullable: true })
    category: string | null;

    @Index()
    @Column({ length: 128, nullable: true })
    city: string | null;

    @Column({ length: 128, nullable: true })
    role: string | null;

    @Column({ type: "int", default: 1 })
    useCount: number;

    @Column({ type: "datetime", nullable: true })
    lastUsedAt: Date | null;

    /** issue | contact | feedback | teach */
    @Column({ length: 32, default: "issue" })
    source: string;

    @Column({ type: "int", nullable: true })
    sourceIssueId: number | null;

    @Column({ type: "text", nullable: true })
    notes: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
