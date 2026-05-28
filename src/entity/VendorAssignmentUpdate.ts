import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { VendorAssignment } from "./VendorAssignment";

@Entity("vendor_assignment_updates")
export class VendorAssignmentUpdate {
    @PrimaryGeneratedColumn({ type: "int" })
    id: number;

    @Column({ type: "int" })
    vendorAssignmentId: number;

    @ManyToOne(() => VendorAssignment, assignment => assignment.updates, { onDelete: "CASCADE" })
    @JoinColumn({ name: "vendorAssignmentId" })
    assignment: VendorAssignment;

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
