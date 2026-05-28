import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { VendorProfile } from "./VendorProfile";

@Entity("vendor_profile_updates")
export class VendorProfileUpdate {
    @PrimaryGeneratedColumn({ type: "int" })
    id: number;

    @Column({ type: "int" })
    vendorProfileId: number;

    @ManyToOne(() => VendorProfile, profile => profile.updates, { onDelete: "CASCADE" })
    @JoinColumn({ name: "vendorProfileId" })
    vendorProfile: VendorProfile;

    @Column({ type: "text", nullable: true })
    updates: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @DeleteDateColumn({ type: "timestamp", nullable: true })
    deletedAt: Date | null;

    @Column({ nullable: true })
    createdBy: string | null;

    @Column({ nullable: true })
    updatedBy: string | null;

    @Column({ nullable: true })
    deletedBy: string | null;
}
