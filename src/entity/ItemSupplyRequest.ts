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

@Entity("item_supply_requests")
export class ItemSupplyRequest {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => ClientPropertyEntity, { onDelete: "CASCADE" })
    @JoinColumn({ name: "property_id" })
    property: ClientPropertyEntity;

    @Column({ name: "property_id" })
    propertyId: number;

    @Column({ type: "text", nullable: true })
    itemsToRestock: string;

    @Column({ nullable: true })
    isUrgent: string;

    @Column({ nullable: true })
    approvedByClient: string;

    @Column({ type: "text", nullable: true })
    sendToAddress: string;

    @Column({ nullable: true })
    requestedBy: string;

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
