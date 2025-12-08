import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToOne, OneToMany } from 'typeorm';
import { PropertyInfo } from './PropertyInfo';
import { SuppliesToRestock } from './SuppliesToRestock';
import { VendorInfo } from './VendorInfo';

@Entity('property_vendor_management')
export class PropertyVendorManagement {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;


    //Cleaning Service
    @Column({ nullable: true })
    cleanerManagedBy: string;

    @Column({ type: "text", nullable: true })   // When Luxury Lodging manages the cleaner, why?
    cleanerManagedByReason: string;

    @Column({ nullable: true })
    maintenanceBy: string;

    @Column({ nullable: true })
    maintenanceManagedBy: string;

    @Column({ type: "text", nullable: true })
    maintenanceManagedByReason: string;

    @Column({ nullable: true })
    biWeeklyInspection: string;

    @Column({ nullable: true })
    hasCurrentCleaner: string;

    @Column({ type: "text", nullable: true })
    hasCurrentCleanerReason: string;

    @Column({ nullable: true })
    cleaningFee: number;

    @Column({ nullable: true })
    cleanerName: string;

    @Column({ nullable: true })
    cleanerPhone: string;

    @Column({ nullable: true })
    cleanerEmail: string;

    @Column({ type: "boolean", nullable: true })
    acknowledgeCleanerResponsibility: boolean;

    @Column({ type: "text", nullable: true })
    acknowledgeCleanerResponsibilityReason: string;

    @Column({ type: "boolean", nullable: true })
    ensureCleanersScheduled: boolean;

    @Column({ type: "text", nullable: true })
    ensureCleanersScheduledReason: string;

    @Column({ type: "boolean", nullable: true })
    propertyCleanedBeforeNextCheckIn: boolean;

    @Column({ type: "text", nullable: true })
    propertyCleanedBeforeNextCheckInReason: string;

    @Column({ type: "boolean", nullable: true })
    luxuryLodgingReadyAssumption: boolean;

    @Column({ type: "text", nullable: true })
    luxuryLodgingReadyAssumptionReason: string;

    @Column({ type: "boolean", nullable: true })
    requestCalendarAccessForCleaner: boolean;

    @Column({ type: "text", nullable: true })
    requestCalendarAccessForCleanerReason: string;

    @Column({ type: "text", nullable: true })
    cleaningTurnoverNotes: string;


    // Restocking Supplies
    @Column({ nullable: true })
    restockingSuppliesManagedBy: string;

    @Column({ type: "text", nullable: true })
    restockingSuppliesManagedByReason: string;

    @Column({ nullable: true })
    supplyClosetLocation: string;

    @Column({ nullable: true })
    supplyClosetCode: string;

    @Column({ type: "boolean", nullable: true })
    luxuryLodgingRestockWithoutApproval: boolean;

    @Column({ type: "boolean", nullable: true })
    luxuryLodgingConfirmBeforePurchase: boolean;

    //Supplies To Restock
    @OneToMany(() => SuppliesToRestock, (suppliesToRestock) => suppliesToRestock.propertyVendorManagementId, {
        cascade: true,
        eager: false,
        onDelete: "CASCADE"
    })
    suppliesToRestock: SuppliesToRestock[];

    //Other Contractors/Vendors
    @OneToMany(() => VendorInfo, (vendorInfo) => vendorInfo.propertyVendorManagementId, {
        cascade: true,
        eager: false,
        onDelete: "CASCADE"
    })
    vendorInfo: VendorInfo[];

    @Column({ type: "text", nullable: true })
    addtionalVendorManagementNotes: string;

    @Column({ type: "boolean", nullable: true })
    acknowledgeExpensesBilledToStatement: boolean;

    


    @OneToOne(() => PropertyInfo, (property) => property.vendorManagementInfo, { onDelete: "CASCADE" })
    @JoinColumn()
    propertyInfo: PropertyInfo;
}