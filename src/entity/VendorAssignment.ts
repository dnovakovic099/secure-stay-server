import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { VendorProfile } from "./VendorProfile";
import { VendorAssignmentUpdate } from "./VendorAssignmentUpdate";

@Entity("vendor_assignments")
export class VendorAssignment {
    @PrimaryGeneratedColumn({ type: "int" })
    id: number;

    @Column({ type: "int" })
    vendorProfileId: number;

    @ManyToOne(() => VendorProfile, profile => profile.assignments, { onDelete: "CASCADE" })
    @JoinColumn({ name: "vendorProfileId" })
    vendorProfile: VendorProfile;

    @Column({ type: "varchar", length: 100 })
    listingId: string;

    @Column({ type: "varchar", length: 255, nullable: true })
    role: string | null;

    @Column({ type: "varchar", length: 50, nullable: true })
    status: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    managedBy: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    workSchedule: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    paymentScheduleType: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    paymentMethod: string | null;

    @Column({ type: "boolean", default: false })
    isAutoPay: boolean;

    @Column({ type: "varchar", length: 100, nullable: true })
    paidBy: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    rate: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    rateType: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    customRateDescription: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    workScheduleDays: string | null;

    @Column({ type: "int", nullable: true })
    workScheduleIntervalWeeks: number | null;

    @Column({ type: "int", nullable: true })
    workScheduleDayOfMonth: number | null;

    @Column({ type: "varchar", length: 50, nullable: true })
    workScheduleQuarter: string | null;

    @Column({ type: "varchar", length: 50, nullable: true })
    workScheduleMonth: string | null;

    @Column({ type: "varchar", length: 100, nullable: true })
    workScheduleCheckoutTiming: string | null;

    @Column({ type: "int", nullable: true })
    trustLevel: number | null;

    @Column({ type: "int", nullable: true })
    speed: number | null;

    @Column({ type: "int", nullable: true })
    costRating: number | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    website_name: string | null;

    @Column({ type: "varchar", length: 2048, nullable: true })
    website_link: string | null;

    @Column({ type: "text", nullable: true })
    notes: string | null;

    @Column({ type: "text", nullable: true })
    payoutDetails: string | null;

    @Column({ type: "int", nullable: true })
    paymentIntervalMonth: number | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    paymentDayOfWeek: string | null;

    @Column({ type: "int", nullable: true })
    paymentWeekOfMonth: number | null;

    @Column({ type: "int", nullable: true })
    paymentDayOfMonth: number | null;

    @Column({ type: "timestamp", nullable: true })
    nextServiceDate: Date | null;

    @Column({ type: "int", nullable: true })
    legacyContactId: number | null;

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

    @OneToMany(() => VendorAssignmentUpdate, update => update.assignment)
    updates: VendorAssignmentUpdate[];
}
