import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
    JoinColumn,
} from "typeorm";
import { PropertyVendorManagement } from "./PropertyVendorManagement";

@Entity("vendor_info")
export class VendorInfo {
    @PrimaryGeneratedColumn()
    id: string;

    @Column({ nullable: true })
    workCategory: string;

    @Column({ nullable: true })
    managedBy: string;

    @Column({ nullable: true })
    name: string;

    @Column({ nullable: true })
    contact: string;

    @Column({ nullable: true })
    email: string;

    @Column({ nullable: true })
    scheduleType: string;

    @Column({ nullable: true })
    intervalMonth: number;

    @Column({ nullable: true })
    dayOfWeek: string;

    @Column({ nullable: true })
    weekOfMonth: number;

    @Column({ nullable: true })
    dayOfMonth: number;

    @Column({ type: "text", nullable: true })
    notes: string;

    @ManyToOne(() => PropertyVendorManagement, (propertyVendorManagement) => propertyVendorManagement.vendorInfo, {
        onDelete: "CASCADE"
    })
    @JoinColumn()
    propertyId: PropertyVendorManagement;


    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
