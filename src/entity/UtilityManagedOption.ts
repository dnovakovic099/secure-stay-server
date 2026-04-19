import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type UtilityManagedOptionKind = "providerName" | "accountName" | "username";

@Entity("utility_managed_option")
export class UtilityManagedOption {
    @PrimaryGeneratedColumn({ type: "int" })
    id: number;

    @Column({ type: "varchar", length: 50 })
    kind: UtilityManagedOptionKind;

    @Column({ type: "varchar", length: 255 })
    label: string;

    @Column({ name: "sort_order", type: "int", default: 0 })
    sortOrder: number;

    @Column({ name: "is_active", type: "boolean", default: true })
    isActive: boolean;

    @CreateDateColumn({ name: "created_at", type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at", type: "timestamp" })
    updatedAt: Date;

    @DeleteDateColumn({ name: "deleted_at", type: "timestamp", nullable: true })
    deletedAt: Date | null;

    @Column({ name: "created_by", nullable: true })
    createdBy: string | null;

    @Column({ name: "updated_by", nullable: true })
    updatedBy: string | null;

    @Column({ name: "deleted_by", nullable: true })
    deletedBy: string | null;
}
