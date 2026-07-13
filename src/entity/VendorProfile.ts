import { Column, CreateDateColumn, DeleteDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { VendorAssignment } from "./VendorAssignment";
import { VendorProfileUpdate } from "./VendorProfileUpdate";

@Entity("vendor_profiles")
export class VendorProfile {
    @PrimaryGeneratedColumn({ type: "int" })
    id: number;

    @Column({ type: "varchar", length: 255 })
    name: string;

    @Column({ type: "varchar", length: 255, nullable: true })
    companyName: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    contact: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    email: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    source: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    vendorAddress: string | null;

    @Column({ type: "text", nullable: true })
    notes: string | null;

    @Column({ type: "varchar", length: 2048, nullable: true })
    avatarUrl: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    icon: string | null;

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

    @OneToMany(() => VendorAssignment, assignment => assignment.vendorProfile)
    assignments: VendorAssignment[];

    @OneToMany(() => VendorProfileUpdate, update => update.vendorProfile)
    updates: VendorProfileUpdate[];
}
