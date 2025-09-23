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

@Entity("supplies_to_restock")
export class SuppliesToRestock {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    supplyName: string;

    @Column({ type: "text", nullable: true })
    notes: string;

    @ManyToOne(() => PropertyVendorManagement, (propertyVendorManagement) => propertyVendorManagement.suppliesToRestock, {
        onDelete: "CASCADE"
    })
    @JoinColumn()
    propertyVendorManagementId: PropertyVendorManagement;


    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
