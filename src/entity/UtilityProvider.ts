import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type UtilityProviderPropertyLink = {
    propertyId: number;
    accountNumber: string | null;
    propertyNotes: string | null;
    source?: string | null;
    managedBy?: string | null;
    workSchedule?: string | null;
    workScheduleDays?: string | null;
    workScheduleIntervalWeeks?: number | null;
    workScheduleDayOfMonth?: number | null;
    workScheduleQuarter?: string | null;
    workScheduleMonth?: string | null;
    workScheduleCheckoutTiming?: string | null;
    autopay: boolean;
    paymentMethod: string | null;
    paymentScheduleType?: string | null;
    paidBy?: string | null;
    rate?: string | null;
    rateType?: string | null;
    customRateDescription?: string | null;
    payoutDetails?: string | null;
    paymentIntervalMonth?: number | null;
    paymentDayOfWeek?: string | null;
    paymentWeekOfMonth?: number | null;
    paymentDayOfMonth?: number | null;
    nextServiceDate?: string | null;
};

@Entity("utility_provider")
export class UtilityProvider {
    @PrimaryGeneratedColumn({ type: "int" })
    id: number;

    @Column({ type: "varchar", length: 100 })
    providerType: string;

    @Column({ type: "varchar", length: 150, nullable: true })
    customProviderLabel: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    providerName: string | null;

    @Column({ type: "varchar", length: 255, nullable: true, name: "account_name" })
    accountName: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    username: string | null;

    @Column({ type: "varchar", length: 500, nullable: true })
    website: string | null;

    @Column({ type: "text", nullable: true })
    password: string | null;

    @Column({ type: "boolean", default: false })
    lastpass: boolean;

    @Column({ type: "text", nullable: true })
    notes: string | null;

    @Column({ type: "simple-json", nullable: true })
    propertyIds: number[];

    @Column({ type: "simple-json", nullable: true })
    propertyLinks: UtilityProviderPropertyLink[];

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
