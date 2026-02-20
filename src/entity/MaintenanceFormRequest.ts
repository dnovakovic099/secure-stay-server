import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
} from "typeorm";
import { ClientPropertyEntity } from "./ClientProperty";

@Entity("maintenance_form_requests")
export class MaintenanceFormRequest {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => ClientPropertyEntity, { onDelete: "CASCADE" })
    @JoinColumn({ name: "property_id" })
    property: ClientPropertyEntity;

    @Column({ name: "property_id" })
    propertyId: number;

    @Column({ nullable: true })
    budget: string;

    @Column({ nullable: true })
    email: string;

    @Column({ type: "text", nullable: true })
    scopeOfWork: string;

    @Column({ type: "text", nullable: true })
    propertyAccessInformation: string;

    @Column({ nullable: true })
    expectedTimeframe: string;

    @Column({ nullable: true, default: "new" })
    status: string;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}
